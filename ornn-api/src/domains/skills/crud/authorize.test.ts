/**
 * Unit tests for `buildActorContext` — the single source that derives the
 * caller's object-level authorization actor from a request (#826).
 *
 * `buildActorContext(c)` consumes exactly two context keys:
 *   - `c.get("auth")` (via `getAuth`)                       → throws 401 when absent
 *   - `c.get("getUserOrgMembershipResolution")` (lazy)      → memberships +
 *     resolved/unresolved discriminant passthrough (#842)
 *
 * Each case stubs a minimal fake Hono context — a plain `{ get }` cast to
 * the Context type — wiring only those two keys. No env mutation, no DB,
 * no NyxID round-trip: the lazy getter is a plain resolved promise.
 */

import { describe, expect, it } from "bun:test";
import type { Context } from "hono";
import { buildActorContext } from "./authorize";
import {
  type AuthContext,
  type AuthVariables,
  type OrgMembershipFact,
  type OrgMembershipResolution,
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";

/**
 * Build a fake Hono context exposing only the keys buildActorContext reads.
 *
 * `resolution` mirrors what `nyxidOrgLookupMiddleware` would memoize. When
 * omitted the resolution getter is unmounted, so `buildActorContext` falls
 * back to the helper's `{ status: "resolved", memberships: [] }` default
 * (the "middleware not mounted" path).
 */
function fakeContext(opts: {
  auth?: AuthContext;
  resolution?: OrgMembershipResolution;
}): Context<{ Variables: AuthVariables }> {
  const getter =
    opts.resolution !== undefined
      ? async () => opts.resolution as OrgMembershipResolution
      : undefined;
  const store: Record<string, unknown> = {
    auth: opts.auth,
    getUserOrgMembershipResolution: getter,
  };
  return {
    get: (key: string) => store[key],
  } as unknown as Context<{ Variables: AuthVariables }>;
}

/** Convenience: a resolved resolution carrying the given memberships. */
function resolved(memberships: OrgMembershipFact[]): OrgMembershipResolution {
  return { status: "resolved", memberships };
}

function authWith(permissions: string[]): AuthContext {
  return {
    userId: "user-1",
    email: "u@example.com",
    displayName: "User One",
    roles: [],
    permissions,
  };
}

describe("buildActorContext", () => {
  it("(a) flags platform admin when caller holds ornn:admin:skill", async () => {
    const c = fakeContext({ auth: authWith(["ornn:admin:skill"]), resolution: resolved([]) });
    const actor = await buildActorContext(c);
    expect(actor.isPlatformAdmin).toBe(true);
    expect(actor.userId).toBe("user-1");
  });

  it("(b) does not flag platform admin without ornn:admin:skill", async () => {
    const c = fakeContext({ auth: authWith(["ornn:skill:read"]), resolution: resolved([]) });
    const actor = await buildActorContext(c);
    expect(actor.isPlatformAdmin).toBe(false);
  });

  it("(c) throws 401 AppError when unauthenticated (no auth on context)", async () => {
    const c = fakeContext({ resolution: resolved([]) });
    let thrown: unknown;
    try {
      await buildActorContext(c);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(401);
  });

  it("(d) passes the lazy org-membership getter's array through verbatim", async () => {
    const memberships: OrgMembershipFact[] = [
      { userId: "org-a", role: "admin", displayName: "Org A" },
      { userId: "org-b", role: "member", displayName: "Org B" },
    ];
    const c = fakeContext({ auth: authWith([]), resolution: resolved(memberships) });
    const actor = await buildActorContext(c);
    expect(actor.memberships).toEqual(memberships);
  });

  it("(e) marks membershipsResolved true on a resolved lookup (#842)", async () => {
    const c = fakeContext({ auth: authWith([]), resolution: resolved([]) });
    const actor = await buildActorContext(c);
    // Resolved-empty is still resolved: caller is a member of nothing.
    expect(actor.membershipsResolved).toBe(true);
    expect(actor.memberships).toEqual([]);
  });

  it("(f) marks membershipsResolved false + memberships [] on an unresolved lookup (#842)", async () => {
    const c = fakeContext({
      auth: authWith([]),
      resolution: { status: "unresolved", reason: "lookup_failed", memberships: [] },
    });
    const actor = await buildActorContext(c);
    expect(actor.membershipsResolved).toBe(false);
    expect(actor.memberships).toEqual([]);
  });

  it("(g) defaults to resolved-empty when the resolution getter is unmounted (#842)", async () => {
    // No `resolution` wired → middleware-not-mounted path. Must NOT flip to
    // unresolved, so unrelated tests don't suddenly 503 on a share write.
    const c = fakeContext({ auth: authWith([]) });
    const actor = await buildActorContext(c);
    expect(actor.membershipsResolved).toBe(true);
    expect(actor.memberships).toEqual([]);
  });
});
