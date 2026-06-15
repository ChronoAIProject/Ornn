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
import {
  buildActorContext,
  canManageSkill,
  canReadSkill,
  canWriteSkill,
  type ActorContext,
  type SkillOwnership,
} from "./authorize";
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

/** Build an actor; `orgs` become member-role memberships. */
function actor(userId: string, opts: { admin?: boolean; orgs?: string[] } = {}): ActorContext {
  return {
    userId,
    isPlatformAdmin: opts.admin === true,
    memberships: (opts.orgs ?? []).map((id) => ({ userId: id, role: "member", displayName: id })),
    membershipsResolved: true,
  };
}

/** A private skill owned by `owner` carrying the given typed grants. */
function skill(owner: string, grants: SkillOwnership["grants"], isPrivate = true): SkillOwnership {
  return { createdBy: owner, isPrivate, grants, sharedWithUsers: [], sharedWithOrgs: [] };
}

describe("canReadSkill (#1123 tiers)", () => {
  it("public skill is readable by anyone, including anonymous", () => {
    expect(canReadSkill(skill("owner", [], false), actor(""))).toBe(true);
  });

  it("private skill: author, platform admin read; a stranger does not", () => {
    const s = skill("owner", []);
    expect(canReadSkill(s, actor("owner"))).toBe(true);
    expect(canReadSkill(s, actor("x", { admin: true }))).toBe(true);
    expect(canReadSkill(s, actor("stranger"))).toBe(false);
  });

  it("any grant level confers read — read AND read_write grantees can read", () => {
    const s = skill("owner", [
      { type: "user", id: "reader", level: "read" },
      { type: "user", id: "editor", level: "read_write" },
    ]);
    expect(canReadSkill(s, actor("reader"))).toBe(true);
    expect(canReadSkill(s, actor("editor"))).toBe(true);
  });

  it("org grant confers read to a member", () => {
    const s = skill("owner", [{ type: "org", id: "org-a", level: "read" }]);
    expect(canReadSkill(s, actor("u", { orgs: ["org-a"] }))).toBe(true);
    expect(canReadSkill(s, actor("u", { orgs: ["org-b"] }))).toBe(false);
  });

  it("falls back to legacy read lists when grants is absent (un-migrated doc)", () => {
    const legacy: SkillOwnership = {
      createdBy: "owner",
      isPrivate: true,
      sharedWithUsers: ["reader"],
      sharedWithOrgs: ["org-a"],
    };
    expect(canReadSkill(legacy, actor("reader"))).toBe(true);
    expect(canReadSkill(legacy, actor("u", { orgs: ["org-a"] }))).toBe(true);
    expect(canReadSkill(legacy, actor("stranger"))).toBe(false);
  });
});

describe("canWriteSkill (#1123 READ_WRITE tier)", () => {
  it("author + platform admin may write", () => {
    const s = skill("owner", []);
    expect(canWriteSkill(s, actor("owner"))).toBe(true);
    expect(canWriteSkill(s, actor("x", { admin: true }))).toBe(true);
  });

  it("a read grantee may NOT write; a read_write grantee may", () => {
    const s = skill("owner", [
      { type: "user", id: "reader", level: "read" },
      { type: "user", id: "editor", level: "read_write" },
    ]);
    expect(canWriteSkill(s, actor("reader"))).toBe(false);
    expect(canWriteSkill(s, actor("editor"))).toBe(true);
  });

  it("a read_write org grant lets every member write", () => {
    const s = skill("owner", [{ type: "org", id: "org-a", level: "read_write" }]);
    expect(canWriteSkill(s, actor("u", { orgs: ["org-a"] }))).toBe(true);
    expect(canWriteSkill(s, actor("u", { orgs: ["org-b"] }))).toBe(false);
  });

  it("an un-migrated (legacy-only) doc grants nobody but author/admin write", () => {
    const legacy: SkillOwnership = {
      createdBy: "owner",
      isPrivate: true,
      sharedWithUsers: ["reader"],
      sharedWithOrgs: [],
    };
    // Legacy lists derive to READ — so the shared reader cannot write.
    expect(canWriteSkill(legacy, actor("reader"))).toBe(false);
    expect(canWriteSkill(legacy, actor("owner"))).toBe(true);
  });
});

describe("canManageSkill (#1123 ADMIN tier)", () => {
  it("only author + platform admin administer — a read_write grantee never does", () => {
    const s = skill("owner", [{ type: "user", id: "editor", level: "read_write" }]);
    expect(canManageSkill(s, actor("owner"))).toBe(true);
    expect(canManageSkill(s, actor("x", { admin: true }))).toBe(true);
    expect(canManageSkill(s, actor("editor"))).toBe(false);
  });
});
