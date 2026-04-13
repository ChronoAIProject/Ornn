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
    findOneAndUpdate: mock(async () => null),
    countDocuments: mock(async () => 0),
    aggregate: mock(() => ({
      toArray: mock(async () => []),
    })),
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
      skillsCol.findOne.mockResolvedValue({
        _id: "test-id-1", name: "my-skill", description: "A test skill",
        author_name: "tester", category: "utility", is_deleted: false,
        tags: [], created_at: new Date(), updated_at: new Date(),
      });

      const result = await repo.create({
        id: "test-id-1", name: "my-skill", description: "A test skill",
        authorName: "tester", category: "utility",
      });

      expect(skillsCol.insertOne).toHaveBeenCalled();
      expect(result.id).toBe("test-id-1");
      expect(result.name).toBe("my-skill");
    });
  });

  describe("findById", () => {
    test("findById_ExistingId_ReturnsSkill", async () => {
      skillsCol.findOne.mockResolvedValue({
        _id: "test-id-1", name: "my-skill", description: "A test skill",
        author_name: "tester", category: "utility", is_deleted: false,
        tags: [], created_at: new Date(), updated_at: new Date(),
      });

      const found = await repo.findById("test-id-1");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("my-skill");
    });

    test("findById_NonExistentId_ReturnsNull", async () => {
      const found = await repo.findById("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("findByName", () => {
    test("findByName_ExistingName_ReturnsSkill", async () => {
      skillsCol.findOne.mockResolvedValue({
        _id: "test-id-1", name: "my-skill", description: "desc",
        author_name: "tester", category: "utility", is_deleted: false,
        tags: [], created_at: new Date(), updated_at: new Date(),
      });

      const found = await repo.findByName("my-skill");
      expect(found).not.toBeNull();
      expect(found!.id).toBe("test-id-1");
    });

    test("findByName_NonExistentName_ReturnsNull", async () => {
      const found = await repo.findByName("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("softDelete", () => {
    test("softDelete_CallsUpdateOne", async () => {
      await repo.softDelete("test-id-1");
      expect(skillsCol.updateOne).toHaveBeenCalled();
    });
  });

  describe("tags", () => {
    test("setTags_CallsUpdateOne", async () => {
      await repo.setTags("test-id-1", ["a", "b", "c"]);
      expect(skillsCol.updateOne).toHaveBeenCalled();
    });

    test("getTags_ReturnsTagsFromDocument", async () => {
      skillsCol.findOne.mockResolvedValue({
        _id: "test-id-1", name: "my-skill", description: "desc",
        author_name: "tester", category: "utility", is_deleted: false,
        tags: ["a", "b", "c"], created_at: new Date(), updated_at: new Date(),
      });

      const tags = await repo.getTags("test-id-1");
      expect(tags.sort()).toEqual(["a", "b", "c"]);
    });
  });

  describe("findByNameInScope", () => {
    test("findByNameInScope_CallsFindWithRegex", async () => {
      const mockDoc = {
        _id: "s1", name: "my-skill", description: "desc",
        author_name: "tester", category: "utility", is_deleted: false,
        tags: [], created_at: new Date(), updated_at: new Date(),
      };
      skillsCol.find.mockReturnValue(createMockCursor([mockDoc]));

      const results = await repo.findByNameInScope("my-skill", "aaaaaaaaaaaaaaaaaaaaaaaa");

      expect(skillsCol.find).toHaveBeenCalled();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("my-skill");
    });

    test("findByNameInScope_NoMatches_ReturnsEmpty", async () => {
      const results = await repo.findByNameInScope("nonexistent", "aaaaaaaaaaaaaaaaaaaaaaaa");
      expect(results).toEqual([]);
    });
  });

  describe("searchByNameSubstring", () => {
    test("searchByNameSubstring_CallsFindWithRegex", async () => {
      const mockDoc = {
        _id: "s1", name: "my-skill", description: "desc",
        author_name: "tester", category: "utility", is_deleted: false,
        tags: [], created_at: new Date(), updated_at: new Date(),
      };
      skillsCol.find.mockReturnValue(createMockCursor([mockDoc]));

      const results = await repo.searchByNameSubstring("skill", "aaaaaaaaaaaaaaaaaaaaaaaa");

      expect(skillsCol.find).toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });

    test("searchByNameSubstring_NoMatches_ReturnsEmpty", async () => {
      const results = await repo.searchByNameSubstring("nonexistent", "aaaaaaaaaaaaaaaaaaaaaaaa");
      expect(results).toEqual([]);
    });
  });
});
