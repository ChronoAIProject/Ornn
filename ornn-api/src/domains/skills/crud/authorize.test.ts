/**
 * Unit tests for `buildActorContext` — the single source that derives the
 * caller's object-level authorization actor from a request (#826).
 *
 * `buildActorContext(c)` consumes exactly two context keys:
 *   - `c.get("auth")` (via `getAuth`)            → throws 401 when absent
 *   - `c.get("getUserOrgMemberships")` (lazy)    → memberships passthrough
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
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";

/** Build a fake Hono context exposing only the keys buildActorContext reads. */
function fakeContext(opts: {
  auth?: AuthContext;
  memberships?: OrgMembershipFact[];
}): Context<{ Variables: AuthVariables }> {
  const getter =
    opts.memberships !== undefined
      ? async () => opts.memberships as OrgMembershipFact[]
      : undefined;
  const store: Record<string, unknown> = {
    auth: opts.auth,
    getUserOrgMemberships: getter,
  };
  return {
    get: (key: string) => store[key],
  } as unknown as Context<{ Variables: AuthVariables }>;
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
    const c = fakeContext({ auth: authWith(["ornn:admin:skill"]), memberships: [] });
    const actor = await buildActorContext(c);
    expect(actor.isPlatformAdmin).toBe(true);
    expect(actor.userId).toBe("user-1");
  });

  it("(b) does not flag platform admin without ornn:admin:skill", async () => {
    const c = fakeContext({ auth: authWith(["ornn:skill:read"]), memberships: [] });
    const actor = await buildActorContext(c);
    expect(actor.isPlatformAdmin).toBe(false);
  });

  it("(c) throws 401 AppError when unauthenticated (no auth on context)", async () => {
    const c = fakeContext({ memberships: [] });
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
    const c = fakeContext({ auth: authWith([]), memberships });
    const actor = await buildActorContext(c);
    expect(actor.memberships).toEqual(memberships);
  });
});
