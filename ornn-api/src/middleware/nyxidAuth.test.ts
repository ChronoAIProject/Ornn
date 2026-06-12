/**
 * Getter-level tests for the org-membership lookup middleware (#842).
 *
 * `nyxidOrgLookupMiddleware` attaches two lazy getters that share ONE memo
 * cell and ONE NyxID round-trip:
 *   - `getUserOrgMemberships`            → fail-soft `OrgMembershipFact[]`
 *   - `getUserOrgMembershipResolution`   → resolved/unresolved discriminant
 *
 * These tests pin the discriminant branches, the single-round-trip sharing,
 * and the read-path fail-soft regression guard (read still `[]`-returns in
 * every unresolved case). No env mutation, no import-order coupling: each
 * case builds a fresh Hono app and a fresh fake `OrgMembershipSource`, so the
 * suite is order-independent (the #816 lesson).
 *
 * @module middleware/nyxidAuth.test
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  nyxidOrgLookupMiddleware,
  readUserOrgMemberships,
  readUserOrgMembershipResolution,
  type AuthContext,
  type AuthVariables,
  type OrgMembershipResolution,
  type OrgMembershipFact,
  type OrgMembershipSource,
} from "./nyxidAuth";

/** An auth context with an optional forwarded access token. */
function authWith(token?: string): AuthContext {
  return {
    userId: "user-1",
    email: "u@example.com",
    displayName: "User One",
    roles: [],
    permissions: [],
    ...(token !== undefined ? { userAccessToken: token } : {}),
  };
}

/**
 * Build a fake org source. `listUserOrgs` either returns the supplied rows or
 * throws. `calls` counts how many times NyxID was actually hit so we can
 * assert the single-round-trip memo.
 */
function fakeOrgs(
  behaviour:
    | { kind: "ok"; rows: Array<{ userId: string; role: string; displayName: string }> }
    | { kind: "throw" },
): { source: OrgMembershipSource; calls: () => number } {
  let count = 0;
  const source: OrgMembershipSource = {
    listUserOrgs: async () => {
      count += 1;
      if (behaviour.kind === "throw") {
        throw new Error("nyxid down");
      }
      return behaviour.rows;
    },
  };
  return { source, calls: () => count };
}

/**
 * Run the lookup middleware against a single request whose auth context is
 * `auth` (or absent when undefined), then hand the live Hono context to
 * `inspect` so the test can call the getters with the real memo wiring.
 */
async function withContext(
  orgs: OrgMembershipSource,
  auth: AuthContext | undefined,
  inspect: (c: import("hono").Context<{ Variables: AuthVariables }>) => Promise<void>,
): Promise<void> {
  const app = new Hono<{ Variables: AuthVariables }>();
  if (auth) {
    app.use("*", async (c, next) => {
      c.set("auth", auth);
      await next();
    });
  }
  app.use("*", nyxidOrgLookupMiddleware(orgs));
  app.get("/", async (c) => {
    await inspect(c);
    return c.json({ ok: true });
  });
  const res = await app.request("/");
  expect(res.status).toBe(200);
}

describe("nyxidOrgLookupMiddleware getters (#842)", () => {
  test("no forwarded token → unresolved/no_token, memberships []", async () => {
    const { source, calls } = fakeOrgs({ kind: "ok", rows: [] });
    await withContext(source, authWith(undefined), async (c) => {
      const resolution = await readUserOrgMembershipResolution(c);
      expect(resolution.status).toBe("unresolved");
      expect((resolution as Extract<OrgMembershipResolution, { status: "unresolved" }>).reason).toBe(
        "no_token",
      );
      expect(resolution.memberships).toEqual([]);
      // No token → NyxID was never asked.
      expect(calls()).toBe(0);
      // Read fail-soft regression guard.
      expect(await readUserOrgMemberships(c)).toEqual([]);
    });
  });

  test("listUserOrgs throws → unresolved/lookup_failed, memberships []", async () => {
    const { source } = fakeOrgs({ kind: "throw" });
    await withContext(source, authWith("tok-1"), async (c) => {
      const resolution = await readUserOrgMembershipResolution(c);
      expect(resolution.status).toBe("unresolved");
      expect((resolution as Extract<OrgMembershipResolution, { status: "unresolved" }>).reason).toBe(
        "lookup_failed",
      );
      expect(resolution.memberships).toEqual([]);
      // Read fail-soft regression guard: still [] on a failed lookup.
      expect(await readUserOrgMemberships(c)).toEqual([]);
    });
  });

  test("200-empty → resolved with empty memberships (member of nothing)", async () => {
    const { source } = fakeOrgs({ kind: "ok", rows: [] });
    await withContext(source, authWith("tok-1"), async (c) => {
      const resolution = await readUserOrgMembershipResolution(c);
      expect(resolution.status).toBe("resolved");
      expect(resolution.memberships).toEqual([]);
      // Read path agrees.
      expect(await readUserOrgMemberships(c)).toEqual([]);
    });
  });

  test("200-with-orgs → resolved, filtered to admin + member roles", async () => {
    const { source } = fakeOrgs({
      kind: "ok",
      rows: [
        { userId: "org-a", role: "admin", displayName: "Org A" },
        { userId: "org-b", role: "member", displayName: "Org B" },
        // Viewers are non-members for Ornn — filtered out.
        { userId: "org-c", role: "viewer", displayName: "Org C" },
      ],
    });
    await withContext(source, authWith("tok-1"), async (c) => {
      const resolution = await readUserOrgMembershipResolution(c);
      expect(resolution.status).toBe("resolved");
      const expected: OrgMembershipFact[] = [
        { userId: "org-a", role: "admin", displayName: "Org A" },
        { userId: "org-b", role: "member", displayName: "Org B" },
      ];
      expect(resolution.memberships).toEqual(expected);
      expect(await readUserOrgMemberships(c)).toEqual(expected);
    });
  });

  test("both getters share ONE NyxID round-trip", async () => {
    const { source, calls } = fakeOrgs({
      kind: "ok",
      rows: [{ userId: "org-a", role: "admin", displayName: "Org A" }],
    });
    await withContext(source, authWith("tok-1"), async (c) => {
      // Hit both getters, twice each, in mixed order.
      await readUserOrgMemberships(c);
      await readUserOrgMembershipResolution(c);
      await readUserOrgMembershipResolution(c);
      await readUserOrgMemberships(c);
      // Memoized — NyxID was asked exactly once.
      expect(calls()).toBe(1);
    });
  });
});
