/**
 * UT-ASST-RETR-* — ScopedSkillRetriever + projectSafeSkill (#970).
 *
 * The data-safety boundary: these tests pin that retrieval is
 * visibility-scoped at BOTH layers and that the projection NEVER carries
 * a PII / secret / private-membership field into the result.
 *
 * @module domains/assistant/retrieval.test
 */

import { describe, expect, it } from "bun:test";
import type { SkillDocument } from "../../shared/types/index";
import type { ActorContext } from "../skills/crud/authorize";
import {
  ScopedSkillRetriever,
  projectSafeSkill,
  type SkillSearchPort,
} from "./retrieval";

function skillDoc(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    guid: "g-1",
    name: "slack-poster",
    description: "Post messages to Slack",
    license: "MIT",
    compatibility: null,
    metadata: { category: "messaging", tags: ["slack", "chat"] },
    skillHash: "sha256:DEADBEEFsecrethash",
    storageKey: "skills/g-1/1.0.0.zip",
    createdBy: "user-author",
    createdByEmail: "author@secret.example",
    createdByDisplayName: "Author Secret Name",
    createdOn: new Date("2026-01-02T03:04:05.000Z"),
    updatedBy: "user-author",
    updatedOn: new Date("2026-01-02T03:04:05.000Z"),
    isPrivate: false,
    sharedWithUsers: ["secret-grantee"],
    sharedWithOrgs: ["secret-org"],
    latestVersion: "1.0.0",
    ...overrides,
  };
}

const ACTOR: ActorContext = {
  userId: "u-caller",
  memberships: [{ userId: "org-a", role: "member", displayName: "Org A" }],
  isPlatformAdmin: false,
  membershipsResolved: true,
};

class FakeSearch implements SkillSearchPort {
  lastArgs: unknown[] = [];
  next: SkillDocument[] = [];
  async keywordSearch(
    query: string,
    scope: string,
    currentUserId: string,
    userOrgIds: string[],
    page: number,
    pageSize: number,
  ) {
    this.lastArgs = [query, scope, currentUserId, userOrgIds, page, pageSize];
    return { skills: this.next, total: this.next.length };
  }
}

describe("projectSafeSkill", () => {
  it("UT-ASST-RETR-001: keeps only SAFE fields, drops all PII/secret fields", () => {
    const projected = projectSafeSkill(skillDoc());
    expect(projected).toEqual({
      name: "slack-poster",
      description: "Post messages to Slack",
      tags: ["slack", "chat"],
      category: "messaging",
      createdOn: "2026-01-02T03:04:05.000Z",
      createdBy: "user-author",
    });
    // Belt: the serialized projection must not carry any forbidden field.
    const json = JSON.stringify(projected);
    for (const forbidden of [
      "author@secret.example",
      "Author Secret Name",
      "DEADBEEF",
      "storage",
      "secret-grantee",
      "secret-org",
      "isPrivate",
      "skillHash",
    ]) {
      expect(json.includes(forbidden)).toBe(false);
    }
  });

  it("UT-ASST-RETR-002: missing tags → empty array, never undefined", () => {
    const projected = projectSafeSkill(
      skillDoc({ metadata: { category: "misc" } }),
    );
    expect(projected.tags).toEqual([]);
    expect(projected.category).toBe("misc");
  });
});

describe("ScopedSkillRetriever", () => {
  it("UT-ASST-RETR-003: queries with the 'mixed' scope + actor org ids", async () => {
    const search = new FakeSearch();
    const retriever = new ScopedSkillRetriever({ search, maxResults: 5 });
    await retriever.retrieve("how do I post to slack", ACTOR);
    expect(search.lastArgs[1]).toBe("mixed");
    expect(search.lastArgs[2]).toBe("u-caller");
    expect(search.lastArgs[3]).toEqual(["org-a"]);
    expect(search.lastArgs[5]).toBe(5); // pageSize == maxResults
  });

  it("UT-ASST-RETR-004: blank query → no search call, empty result", async () => {
    const search = new FakeSearch();
    const retriever = new ScopedSkillRetriever({ search });
    expect(await retriever.retrieve("   ", ACTOR)).toEqual([]);
    // FakeSearch records args only when called — empty means never invoked.
    expect(search.lastArgs).toEqual([]);
  });

  it("UT-ASST-RETR-005: projection-layer canReadSkill drops an unreadable doc", async () => {
    // Simulate a query-layer regression that returned a private skill the
    // actor cannot read. The projection-layer guard MUST drop it.
    const search = new FakeSearch();
    search.next = [
      skillDoc({ guid: "pub", name: "public-skill", isPrivate: false }),
      skillDoc({
        guid: "priv",
        name: "someone-elses-private",
        isPrivate: true,
        createdBy: "other-user",
        sharedWithUsers: [],
        sharedWithOrgs: [],
      }),
    ];
    const retriever = new ScopedSkillRetriever({ search });
    const result = await retriever.retrieve("anything", ACTOR);
    expect(result.map((r) => r.name)).toEqual(["public-skill"]);
  });

  it("UT-ASST-RETR-006: caps results at maxResults", async () => {
    const search = new FakeSearch();
    search.next = Array.from({ length: 10 }, (_, i) =>
      skillDoc({ guid: `g${i}`, name: `skill-${i}`, isPrivate: false }),
    );
    const retriever = new ScopedSkillRetriever({ search, maxResults: 3 });
    const result = await retriever.retrieve("x", ACTOR);
    expect(result.length).toBe(3);
  });

  it("UT-ASST-RETR-007: private skill shared with actor's org IS readable", async () => {
    const search = new FakeSearch();
    search.next = [
      skillDoc({
        guid: "shared",
        name: "org-shared-skill",
        isPrivate: true,
        createdBy: "other",
        sharedWithUsers: [],
        sharedWithOrgs: ["org-a"], // actor is a member of org-a
      }),
    ];
    const retriever = new ScopedSkillRetriever({ search });
    const result = await retriever.retrieve("x", ACTOR);
    expect(result.map((r) => r.name)).toEqual(["org-shared-skill"]);
  });
});
