/**
 * SkillsetSearchService unit tests (#969).
 *
 * In-memory `findByScope` fake; pins that kind / tags / scope params are
 * forwarded correctly and the response envelope is shaped right.
 *
 * @module domains/skillsets/search/service.test
 */

import { describe, expect, it } from "bun:test";
import { SkillsetSearchService } from "./service";
import type { SkillsetRepository } from "../repository";
import type { SkillsetDocument } from "../types";

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
    latestVersion: "1.0",
    ...overrides,
  };
}

function makeService(
  capture: (args: unknown[]) => void,
  result: { skillsets: SkillsetDocument[]; total: number },
) {
  const skillsetRepo = {
    findByScope: async (...args: unknown[]) => {
      capture(args);
      return result;
    },
  } as unknown as SkillsetRepository;
  return new SkillsetSearchService({ skillsetRepo });
}

describe("SkillsetSearchService", () => {
  it("forwards kind + tags filters to findByScope", async () => {
    let captured: unknown[] = [];
    const service = makeService(
      (a) => (captured = a),
      { skillsets: [doc({ kind: "consensus-supported" })], total: 1 },
    );
    const res = await service.search({
      scope: "public",
      currentUserId: "",
      userOrgIds: [],
      page: 1,
      pageSize: 20,
      kind: "consensus-supported",
      tagsAll: ["x"],
    });
    // findByScope(scope, userId, orgIds, page, pageSize, filters)
    expect(captured[0]).toBe("public");
    expect(captured[5]).toEqual({ kind: "consensus-supported", tagsAll: ["x"] });
    expect(res.items[0]!.kind).toBe("consensus-supported");
    expect(res.total).toBe(1);
    expect(res.totalPages).toBe(1);
  });

  it("maps documents to lighter search items", async () => {
    const service = makeService(() => {}, {
      skillsets: [doc({ guid: "g1", name: "a" }), doc({ guid: "g2", name: "b" })],
      total: 2,
    });
    const res = await service.search({
      scope: "public",
      currentUserId: "",
      userOrgIds: [],
      page: 1,
      pageSize: 20,
    });
    expect(res.items.map((i) => i.name)).toEqual(["a", "b"]);
    expect(res.items[0]!.createdOn).toBe("2026-01-01T00:00:00.000Z");
  });

  it("computes totalPages from total + pageSize", async () => {
    const service = makeService(() => {}, { skillsets: [], total: 45 });
    const res = await service.search({
      scope: "public",
      currentUserId: "",
      userOrgIds: [],
      page: 1,
      pageSize: 20,
    });
    expect(res.totalPages).toBe(3);
  });
});
