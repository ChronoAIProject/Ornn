/**
 * SkillsetSearchService unit tests (#969, reworked for #1136).
 *
 * In-memory repo + skillset-service fakes. Pins:
 *   - cheap scopes (public/mine) forward filters to `findCheapScope` and
 *     shape the response envelope.
 *   - live scopes (private/mixed/shared-with-me) fetch candidates, pass
 *     own/all-public without a member check, live-check restricted-by-others
 *     via `canDiscoverSkillset`, and paginate the filtered set in-memory.
 *
 * @module domains/skillsets/search/service.test
 */

import { describe, expect, it } from "bun:test";
import { SkillsetSearchService } from "./service";
import type { SkillsetRepository } from "../repository";
import type { SkillsetService } from "../service";
import type { ActorContext } from "../../skills/crud/authorize";
import type { SkillsetDocument } from "../types";

function actorFor(userId: string): ActorContext {
  return { userId, memberships: [], isPlatformAdmin: false, membershipsResolved: true };
}

function doc(overrides: Partial<SkillsetDocument> = {}): SkillsetDocument {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    guid: "ss-1",
    name: "review-set",
    description: "d",
    kind: "generic",
    tags: [],
    createdBy: "owner-1",
    createdOn: now,
    updatedBy: "owner-1",
    updatedOn: now,
    isPrivate: false,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    memberVisibilityState: "all-public",
    latestVersion: "1.0",
    ...overrides,
  };
}

interface Fakes {
  cheap?: (args: unknown[]) => { skillsets: SkillsetDocument[]; total: number };
  candidates?: { candidates: SkillsetDocument[]; capped: boolean };
  /** guids the actor CAN discover (live check). */
  discoverable?: Set<string>;
}

function makeService(fakes: Fakes, captureCheap?: (args: unknown[]) => void) {
  const skillsetRepo = {
    findCheapScope: async (...args: unknown[]) => {
      captureCheap?.(args);
      return fakes.cheap ? fakes.cheap(args) : { skillsets: [], total: 0 };
    },
    findLiveScopeCandidates: async () => fakes.candidates ?? { candidates: [], capped: false },
  } as unknown as SkillsetRepository;

  const skillsetService = {
    canDiscoverSkillset: async (s: SkillsetDocument) =>
      fakes.discoverable ? fakes.discoverable.has(s.guid) : false,
  } as unknown as SkillsetService;

  return new SkillsetSearchService({ skillsetRepo, skillsetService });
}

describe("SkillsetSearchService — cheap scopes (public/mine)", () => {
  it("forwards kind + tags filters to findCheapScope", async () => {
    let captured: unknown[] = [];
    const service = makeService(
      { cheap: () => ({ skillsets: [doc({ kind: "consensus-supported" })], total: 1 }) },
      (a) => (captured = a),
    );
    const res = await service.search({
      scope: "public",
      actor: actorFor(""),
      page: 1,
      pageSize: 20,
      kind: "consensus-supported",
      tagsAll: ["x"],
    });
    // findCheapScope(scope, caller, page, pageSize, filters)
    expect(captured[0]).toBe("public");
    expect(captured[4]).toEqual({ kind: "consensus-supported", tagsAll: ["x"], q: undefined });
    expect(res.items[0]!.kind).toBe("consensus-supported");
    expect(res.total).toBe(1);
    expect(res.totalPages).toBe(1);
  });

  it("maps documents to lighter search items, carrying memberVisibilityState", async () => {
    const service = makeService({
      cheap: () => ({
        skillsets: [doc({ guid: "g1", name: "a", memberVisibilityState: "all-public" }), doc({ guid: "g2", name: "b" })],
        total: 2,
      }),
    });
    const res = await service.search({ scope: "public", actor: actorFor(""), page: 1, pageSize: 20 });
    expect(res.items.map((i) => i.name)).toEqual(["a", "b"]);
    expect(res.items[0]!.memberVisibilityState).toBe("all-public");
    expect(res.items[0]!.createdOn).toBe("2026-01-01T00:00:00.000Z");
  });

  it("computes totalPages from total + pageSize", async () => {
    const service = makeService({ cheap: () => ({ skillsets: [], total: 45 }) });
    const res = await service.search({ scope: "public", actor: actorFor(""), page: 1, pageSize: 20 });
    expect(res.totalPages).toBe(3);
  });
});

describe("SkillsetSearchService — live scopes (#1136 Option-B discovery)", () => {
  it("includes own + all-public without a member check; live-checks restricted-by-others", async () => {
    const own = doc({ guid: "own", createdBy: "u1", memberVisibilityState: "restricted" });
    const pub = doc({ guid: "pub", createdBy: "other", memberVisibilityState: "all-public" });
    const readable = doc({ guid: "readable", createdBy: "other", memberVisibilityState: "restricted" });
    const hidden = doc({ guid: "hidden", createdBy: "other", memberVisibilityState: "restricted" });
    const service = makeService({
      candidates: { candidates: [own, pub, readable, hidden], capped: false },
      // Only `readable` passes the live member-readability check.
      discoverable: new Set(["readable"]),
    });
    const res = await service.search({ scope: "mixed", actor: actorFor("u1"), page: 1, pageSize: 20 });
    // `hidden` is excluded (live check fails) — no leak.
    expect(res.items.map((i) => i.guid).sort()).toEqual(["own", "pub", "readable"]);
    expect(res.total).toBe(3);
  });

  it("paginates the live-filtered set in-memory", async () => {
    // 5 own (auto-pass) candidates, page 2 of size 2 → items 3..4, total 5.
    const candidates = ["a", "b", "c", "d", "e"].map((g) =>
      doc({ guid: g, createdBy: "u1", memberVisibilityState: "restricted" }),
    );
    const service = makeService({ candidates: { candidates, capped: false } });
    const res = await service.search({ scope: "private", actor: actorFor("u1"), page: 2, pageSize: 2 });
    expect(res.total).toBe(5);
    expect(res.items.map((i) => i.guid)).toEqual(["c", "d"]);
    expect(res.totalPages).toBe(3);
  });
});
