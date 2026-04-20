import { describe, test, expect, beforeEach, mock } from "bun:test";
import { TopicService } from "./service";
import type { TopicRepository, TopicSkillRepository } from "./repository";
import type { SkillRepository } from "../skillCrud/repository";
import type { SkillDocument, TopicDocument } from "../../shared/types/index";
import { AppError } from "../../shared/types/index";

/**
 * Unit tests for TopicService. Uses hand-rolled mock repositories so we
 * can verify business logic (scope propagation, visibility filtering,
 * idempotency, cascade hooks) without touching a real Mongo.
 */

const NOW = new Date("2026-04-20T10:00:00Z");
const OWNER_ID = "owner-user";
const OTHER_USER_ID = "other-user";
const ADMIN_ID = "admin-user";

function makeTopic(overrides: Partial<TopicDocument> = {}): TopicDocument {
  return {
    guid: "topic-1",
    name: "python-data",
    description: "",
    createdBy: OWNER_ID,
    createdOn: NOW,
    updatedBy: OWNER_ID,
    updatedOn: NOW,
    isPrivate: false,
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    guid: "skill-1",
    name: "my-skill",
    description: "A skill",
    license: null,
    compatibility: null,
    metadata: { category: "plain" },
    skillHash: "",
    storageKey: "skills/skill-1/0.1.zip",
    createdBy: OWNER_ID,
    createdOn: NOW,
    updatedBy: OWNER_ID,
    updatedOn: NOW,
    isPrivate: false,
    latestVersion: "0.1",
    ...overrides,
  };
}

function createMockTopicRepo(): TopicRepository {
  return {
    ensureIndexes: mock(async () => {}),
    create: mock(async (data) => makeTopic({ guid: data.guid, name: data.name, description: data.description ?? "", isPrivate: data.isPrivate ?? false, createdBy: data.createdBy })),
    findByGuid: mock(async () => null),
    findByName: mock(async () => null),
    update: mock(async (guid, data) => makeTopic({ guid, description: data.description ?? "", isPrivate: data.isPrivate ?? false })),
    hardDelete: mock(async () => {}),
    list: mock(async () => ({ topics: [], total: 0 })),
  } as unknown as TopicRepository;
}

function createMockTopicSkillRepo(): TopicSkillRepository {
  return {
    ensureIndexes: mock(async () => {}),
    add: mock(async () => ({ inserted: true })),
    remove: mock(async () => true),
    countByTopic: mock(async () => 0),
    countsByTopics: mock(async () => new Map<string, number>()),
    listSkillGuidsByTopic: mock(async () => []),
    deleteAllByTopic: mock(async () => 0),
    deleteAllBySkill: mock(async () => 0),
  } as unknown as TopicSkillRepository;
}

function createMockSkillRepo(): SkillRepository {
  return {
    findByGuid: mock(async () => null),
    findByName: mock(async () => null),
    findByGuids: mock(async () => []),
  } as unknown as SkillRepository;
}

describe("TopicService", () => {
  let topicRepo: TopicRepository;
  let topicSkillRepo: TopicSkillRepository;
  let skillRepo: SkillRepository;
  let service: TopicService;

  beforeEach(() => {
    topicRepo = createMockTopicRepo();
    topicSkillRepo = createMockTopicSkillRepo();
    skillRepo = createMockSkillRepo();
    service = new TopicService({ topicRepo, topicSkillRepo, skillRepo });
  });

  describe("createTopic", () => {
    test("passes create args through to the repository", async () => {
      await service.createTopic(
        { name: "my-topic", description: "hello", isPrivate: false },
        { userId: OWNER_ID, userEmail: "o@x", userDisplayName: "Owner" },
      );
      expect(topicRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "my-topic",
          description: "hello",
          createdBy: OWNER_ID,
          createdByEmail: "o@x",
          createdByDisplayName: "Owner",
          isPrivate: false,
        }),
      );
    });

    test("propagates 409 from the repo when name is taken", async () => {
      (topicRepo.create as ReturnType<typeof mock>).mockImplementationOnce(async () => {
        throw AppError.conflict("TOPIC_NAME_EXISTS", "already exists");
      });
      await expect(
        service.createTopic(
          { name: "taken", description: "", isPrivate: false },
          { userId: OWNER_ID },
        ),
      ).rejects.toMatchObject({ code: "TOPIC_NAME_EXISTS", statusCode: 409 });
    });
  });

  describe("listTopics", () => {
    test("populates skillCount for each listed topic", async () => {
      const t1 = makeTopic({ guid: "t1", name: "t1" });
      const t2 = makeTopic({ guid: "t2", name: "t2" });
      (topicRepo.list as ReturnType<typeof mock>).mockImplementationOnce(async () => ({ topics: [t1, t2], total: 2 }));
      (topicSkillRepo.countsByTopics as ReturnType<typeof mock>).mockImplementationOnce(async () => new Map([["t1", 3], ["t2", 0]]));

      const res = await service.listTopics({ query: "", scope: "mixed", page: 1, pageSize: 10, currentUserId: OWNER_ID });

      expect(res.items).toHaveLength(2);
      expect(res.items[0]).toMatchObject({ guid: "t1", skillCount: 3 });
      expect(res.items[1]).toMatchObject({ guid: "t2", skillCount: 0 });
      expect(res.total).toBe(2);
    });

    test("passes scope + pagination to the repo unchanged", async () => {
      await service.listTopics({ query: "python", scope: "public", page: 2, pageSize: 25, currentUserId: OWNER_ID });
      expect(topicRepo.list).toHaveBeenCalledWith(
        expect.objectContaining({ query: "python", scope: "public", page: 2, pageSize: 25 }),
      );
    });
  });

  describe("getTopic", () => {
    test("404 when the topic does not exist", async () => {
      await expect(service.getTopic("missing", { currentUserId: OWNER_ID, isAdmin: false })).rejects.toMatchObject({
        code: "TOPIC_NOT_FOUND",
        statusCode: 404,
      });
    });

    test("404 for private topic viewed by someone who does not own it", async () => {
      const t = makeTopic({ isPrivate: true, createdBy: OWNER_ID });
      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => t);
      await expect(
        service.getTopic(t.guid, { currentUserId: OTHER_USER_ID, isAdmin: false }),
      ).rejects.toMatchObject({ code: "TOPIC_NOT_FOUND" });
    });

    test("admin can read a private topic they do not own", async () => {
      const t = makeTopic({ isPrivate: true, createdBy: OWNER_ID });
      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => t);
      (topicSkillRepo.listSkillGuidsByTopic as ReturnType<typeof mock>).mockImplementationOnce(async () => []);
      const detail = await service.getTopic(t.guid, { currentUserId: ADMIN_ID, isAdmin: true });
      expect(detail.guid).toBe(t.guid);
    });

    test("filters out skills the viewer cannot see (private skill, non-owner, non-admin)", async () => {
      const topic = makeTopic();
      const publicSkill = makeSkill({ guid: "public-skill", name: "public", isPrivate: false, createdBy: OTHER_USER_ID });
      const privateSkill = makeSkill({ guid: "private-skill", name: "private", isPrivate: true, createdBy: OTHER_USER_ID });

      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => topic);
      (topicSkillRepo.listSkillGuidsByTopic as ReturnType<typeof mock>).mockImplementationOnce(async () => ["public-skill", "private-skill"]);
      (skillRepo.findByGuids as ReturnType<typeof mock>).mockImplementationOnce(async () => [publicSkill, privateSkill]);

      const detail = await service.getTopic(topic.guid, { currentUserId: OWNER_ID, isAdmin: false });
      const guids = detail.skills.map((s) => s.guid);
      expect(guids).toContain("public-skill");
      expect(guids).not.toContain("private-skill");
    });

    test("includes private skill when viewer is admin", async () => {
      const topic = makeTopic();
      const privateSkill = makeSkill({ guid: "private-skill", name: "private", isPrivate: true, createdBy: OTHER_USER_ID });
      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => topic);
      (topicSkillRepo.listSkillGuidsByTopic as ReturnType<typeof mock>).mockImplementationOnce(async () => ["private-skill"]);
      (skillRepo.findByGuids as ReturnType<typeof mock>).mockImplementationOnce(async () => [privateSkill]);

      const detail = await service.getTopic(topic.guid, { currentUserId: ADMIN_ID, isAdmin: true });
      expect(detail.skills.map((s) => s.guid)).toContain("private-skill");
    });
  });

  describe("updateTopic", () => {
    test("applies partial update via the repo", async () => {
      const t = makeTopic();
      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => t);
      await service.updateTopic(t.guid, { description: "new" }, OWNER_ID);
      expect(topicRepo.update).toHaveBeenCalledWith(t.guid, expect.objectContaining({ description: "new", updatedBy: OWNER_ID }));
    });

    test("404 when the topic does not exist", async () => {
      await expect(service.updateTopic("missing", { description: "x" }, OWNER_ID)).rejects.toMatchObject({ code: "TOPIC_NOT_FOUND" });
    });
  });

  describe("deleteTopic", () => {
    test("cascades membership before hard-deleting the topic doc", async () => {
      const t = makeTopic();
      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => t);
      await service.deleteTopic(t.guid);
      expect(topicSkillRepo.deleteAllByTopic).toHaveBeenCalledWith(t.guid);
      expect(topicRepo.hardDelete).toHaveBeenCalledWith(t.guid);
    });

    test("404 when the topic does not exist", async () => {
      await expect(service.deleteTopic("missing")).rejects.toMatchObject({ code: "TOPIC_NOT_FOUND" });
    });
  });

  describe("addSkills", () => {
    test("resolves skill ids + names, filters visibility, inserts edges", async () => {
      const topic = makeTopic({ guid: "t", createdBy: OWNER_ID });
      const skillA = makeSkill({ guid: "sa", name: "alpha", createdBy: OWNER_ID, isPrivate: false });
      const skillB = makeSkill({ guid: "sb", name: "beta", createdBy: OWNER_ID, isPrivate: true });

      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => topic);
      (skillRepo.findByGuid as ReturnType<typeof mock>)
        .mockImplementationOnce(async () => skillA)
        .mockImplementationOnce(async () => null); // second lookup falls through to findByName
      (skillRepo.findByName as ReturnType<typeof mock>).mockImplementationOnce(async () => skillB);

      const result = await service.addSkills(
        topic.guid,
        ["sa", "beta"],
        { currentUserId: OWNER_ID, isAdmin: false },
      );

      expect(result.added).toEqual(["sa", "sb"]);
      expect(result.skipped).toEqual([]);
      expect(topicSkillRepo.add).toHaveBeenCalledTimes(2);
    });

    test("403 when the actor cannot see a private skill they do not own", async () => {
      const topic = makeTopic({ guid: "t", createdBy: OWNER_ID });
      const hiddenSkill = makeSkill({ guid: "hidden", name: "hidden", createdBy: OTHER_USER_ID, isPrivate: true });

      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => topic);
      (skillRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => hiddenSkill);

      await expect(
        service.addSkills(topic.guid, ["hidden"], { currentUserId: OWNER_ID, isAdmin: false }),
      ).rejects.toMatchObject({ code: "SKILL_NOT_ACCESSIBLE", statusCode: 403 });
    });

    test("idempotent: re-adding an already-member skill moves it to skipped", async () => {
      const topic = makeTopic({ guid: "t", createdBy: OWNER_ID });
      const skill = makeSkill({ guid: "s", createdBy: OWNER_ID });

      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => topic);
      (skillRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => skill);
      (topicSkillRepo.add as ReturnType<typeof mock>).mockImplementationOnce(async () => ({ inserted: false }));

      const result = await service.addSkills(topic.guid, ["s"], { currentUserId: OWNER_ID, isAdmin: false });
      expect(result.added).toEqual([]);
      expect(result.skipped).toEqual(["s"]);
    });

    test("404 on a missing skill id", async () => {
      const topic = makeTopic();
      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => topic);
      await expect(
        service.addSkills(topic.guid, ["does-not-exist"], { currentUserId: OWNER_ID, isAdmin: false }),
      ).rejects.toMatchObject({ code: "SKILL_NOT_FOUND", statusCode: 404 });
    });
  });

  describe("removeSkill", () => {
    test("delegates to the edge repo", async () => {
      const topic = makeTopic();
      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => topic);
      (topicSkillRepo.remove as ReturnType<typeof mock>).mockImplementationOnce(async () => true);
      const res = await service.removeSkill(topic.guid, "skill-1");
      expect(topicSkillRepo.remove).toHaveBeenCalledWith(topic.guid, "skill-1");
      expect(res).toEqual({ success: true });
    });

    test("404 when the edge does not exist", async () => {
      const topic = makeTopic();
      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => topic);
      (topicSkillRepo.remove as ReturnType<typeof mock>).mockImplementationOnce(async () => false);
      await expect(service.removeSkill(topic.guid, "skill-1")).rejects.toMatchObject({ code: "NOT_IN_TOPIC" });
    });
  });

  describe("findByIdOrName", () => {
    test("tries GUID first, then falls back to name", async () => {
      const t = makeTopic({ name: "python-data" });
      (topicRepo.findByGuid as ReturnType<typeof mock>).mockImplementationOnce(async () => null);
      (topicRepo.findByName as ReturnType<typeof mock>).mockImplementationOnce(async () => t);
      const found = await service.findByIdOrNameRaw("python-data");
      expect(found?.guid).toBe(t.guid);
    });
  });
});
