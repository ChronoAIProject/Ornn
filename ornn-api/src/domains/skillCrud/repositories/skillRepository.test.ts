import { describe, test, expect, beforeEach, mock } from "bun:test";
import { SkillRepository } from "./skillRepository";
import type { Db } from "mongodb";

/**
 * Unit tests for the MongoDB-backed SkillRepository.
 * Uses mocked MongoDB Collection to verify query construction.
 */

function createMockCursor(docs: any[] = []) {
  return {
    sort: mock(function (this: any) { return this; }),
    skip: mock(function (this: any) { return this; }),
    limit: mock(function (this: any) { return this; }),
    toArray: mock(async () => docs),
  };
}

function createMockCollection() {
  return {
    insertOne: mock(async () => ({ acknowledged: true })),
    findOne: mock(async () => null),
    find: mock(() => createMockCursor()),
    updateOne: mock(async () => ({ modifiedCount: 1 })),
    deleteOne: mock(async () => ({ deletedCount: 1 })),
    countDocuments: mock(async () => 0),
  };
}

function createMockDb(): { db: Db; skillsCol: ReturnType<typeof createMockCollection> } {
  const skillsCol = createMockCollection();
  const db = {
    collection: mock((name: string) => {
      if (name === "skills") return skillsCol;
      return createMockCollection();
    }),
  } as unknown as Db;
  return { db, skillsCol };
}

/** Build a minimal valid MongoDB document for a skill. */
function makeSkillDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "test-guid-1",
    name: "my-skill",
    description: "A test skill",
    license: null,
    compatibility: null,
    metadata: { category: "plain" },
    skillHash: "abc123",
    s3Url: "s3://bucket/skills/test-guid-1.zip",
    createdBy: "user-1",
    createdOn: new Date("2026-01-01"),
    updatedBy: "user-1",
    updatedOn: new Date("2026-01-01"),
    isPrivate: true,
    ...overrides,
  };
}

describe("SkillRepository", () => {
  let db: Db;
  let skillsCol: ReturnType<typeof createMockCollection>;
  let repo: SkillRepository;

  beforeEach(() => {
    const mocks = createMockDb();
    db = mocks.db;
    skillsCol = mocks.skillsCol;
    repo = new SkillRepository(db);
  });

  describe("create", () => {
    test("create_ValidData_CallsInsertOne", async () => {
      skillsCol.findOne.mockResolvedValue(makeSkillDoc());

      const result = await repo.create({
        guid: "test-guid-1",
        name: "my-skill",
        description: "A test skill",
        metadata: { category: "plain" },
        skillHash: "abc123",
        s3Url: "s3://bucket/skills/test-guid-1.zip",
        createdBy: "user-1",
      });

      expect(skillsCol.insertOne).toHaveBeenCalled();
      expect(result.guid).toBe("test-guid-1");
      expect(result.name).toBe("my-skill");
    });
  });

  describe("findByGuid", () => {
    test("findByGuid_ExistingGuid_ReturnsSkill", async () => {
      skillsCol.findOne.mockResolvedValue(makeSkillDoc());

      const found = await repo.findByGuid("test-guid-1");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("my-skill");
    });

    test("findByGuid_NonExistentGuid_ReturnsNull", async () => {
      const found = await repo.findByGuid("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("findByName", () => {
    test("findByName_ExistingName_ReturnsSkill", async () => {
      skillsCol.findOne.mockResolvedValue(makeSkillDoc());

      const found = await repo.findByName("my-skill");
      expect(found).not.toBeNull();
      expect(found!.guid).toBe("test-guid-1");
    });

    test("findByName_NonExistentName_ReturnsNull", async () => {
      const found = await repo.findByName("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("hardDelete", () => {
    test("hardDelete_CallsDeleteOne", async () => {
      await repo.hardDelete("test-guid-1");
      expect(skillsCol.deleteOne).toHaveBeenCalled();
    });
  });

  describe("keywordSearch", () => {
    test("keywordSearch_WithQuery_CallsFindAndReturnsResults", async () => {
      const mockDoc = makeSkillDoc();
      skillsCol.find.mockReturnValue(createMockCursor([mockDoc]));
      skillsCol.countDocuments.mockResolvedValue(1);

      const results = await repo.keywordSearch("my-skill", "public", "", 1, 10);

      expect(skillsCol.find).toHaveBeenCalled();
      expect(results.skills).toHaveLength(1);
      expect(results.total).toBe(1);
      expect(results.skills[0].name).toBe("my-skill");
    });

    test("keywordSearch_NoMatches_ReturnsEmpty", async () => {
      const results = await repo.keywordSearch("nonexistent", "public", "", 1, 10);
      expect(results.skills).toEqual([]);
      expect(results.total).toBe(0);
    });
  });

  describe("findByScope", () => {
    test("findByScope_PublicScope_CallsFindWithIsPrivateFalse", async () => {
      const mockDoc = makeSkillDoc({ isPrivate: false });
      skillsCol.find.mockReturnValue(createMockCursor([mockDoc]));
      skillsCol.countDocuments.mockResolvedValue(1);

      const results = await repo.findByScope("public", "", 1, 10);

      expect(skillsCol.find).toHaveBeenCalled();
      expect(results.skills).toHaveLength(1);
      expect(results.total).toBe(1);
    });

    test("findByScope_NoMatches_ReturnsEmpty", async () => {
      const results = await repo.findByScope("public", "", 1, 10);
      expect(results.skills).toEqual([]);
      expect(results.total).toBe(0);
    });
  });

  describe("findByGuids", () => {
    test("findByGuids_EmptyList_ReturnsEmpty", async () => {
      const results = await repo.findByGuids([]);
      expect(results).toEqual([]);
    });

    test("findByGuids_WithGuids_CallsFind", async () => {
      const mockDoc = makeSkillDoc();
      skillsCol.find.mockReturnValue(createMockCursor([mockDoc]));

      const results = await repo.findByGuids(["test-guid-1"]);

      expect(skillsCol.find).toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });
  });

  describe("update", () => {
    test("update_ValidData_CallsUpdateOneAndReturnsUpdated", async () => {
      skillsCol.findOne.mockResolvedValue(makeSkillDoc({ name: "updated-skill" }));

      const result = await repo.update("test-guid-1", {
        name: "updated-skill",
        updatedBy: "user-1",
      });

      expect(skillsCol.updateOne).toHaveBeenCalled();
      expect(result.name).toBe("updated-skill");
    });
  });
});
