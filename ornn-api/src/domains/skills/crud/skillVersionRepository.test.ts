/**
 * SkillVersionRepository unit tests (#874).
 *
 * Backed by mongodb-memory-server (mirrors the notifications / audit
 * repository test harness). The `skill_versions` collection keys each
 * immutable snapshot by `_id = ${skillGuid}@${version}`, giving free
 * uniqueness on (skillGuid, version). Pins:
 *   - ensureIndexes resolves
 *   - create assigns defaults + round-trips through mapDoc, duplicate
 *     `_id` → SKILL_VERSION_EXISTS conflict
 *   - findBySkillAndVersion hit / miss
 *   - findLatestBySkill + listBySkill order major/minor desc (seeded
 *     out of order)
 *   - deleteAllBySkill returns the cascade count
 *   - deleteOne true / false
 *   - setAgentsealScan persists, mapScan nulls a malformed record
 *   - setDeprecation on (note + null-note) / off (clears) / missing → 404
 *
 * @module domains/skills/crud/skillVersionRepository.test
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  SkillVersionRepository,
  type CreateSkillVersionData,
  type AgentsealScanRecord,
} from "./skillVersionRepository";
import { AppError } from "../../../shared/types/index";
import type { SkillMetadata } from "../../../shared/types/index";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: SkillVersionRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("skill_versions_test");
  repo = new SkillVersionRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("skill_versions").deleteMany({});
});

// ---- Fixtures --------------------------------------------------------

const META: SkillMetadata = { category: "plain", tags: ["alpha"] };

function createInput(
  overrides: Partial<CreateSkillVersionData> = {},
): CreateSkillVersionData {
  return {
    skillGuid: "skill-1",
    version: "1.0",
    majorVersion: 1,
    minorVersion: 0,
    storageKey: "skills/skill-1/1.0.zip",
    skillHash: "hash-10",
    metadata: META,
    createdBy: "user-1",
    ...overrides,
  };
}

/** Seed a version row straight into Mongo, bypassing the repo. */
async function seedRaw(doc: Record<string, unknown>): Promise<void> {
  await db.collection("skill_versions").insertOne(doc as never);
}

const scanRecord: AgentsealScanRecord = {
  score: 88,
  findings: [{ rule: "demo", severity: "low" }],
  scannedAt: "2026-01-01T00:00:00.000Z",
  agentsealVersion: "0.3.1",
  scannedFiles: 4,
};

describe("ensureIndexes", () => {
  test("resolves without throwing (idempotent across calls)", async () => {
    await expect(repo.ensureIndexes()).resolves.toBeUndefined();
    await expect(repo.ensureIndexes()).resolves.toBeUndefined();
  });
});

describe("create", () => {
  test("persists with _id = guid@version and applies null defaults", async () => {
    const created = await repo.create(createInput());
    expect(created._id).toBe("skill-1@1.0");
    expect(created.skillGuid).toBe("skill-1");
    expect(created.version).toBe("1.0");
    // Unset optionals coerce to null on the doc, undefined on the mapped view.
    expect(created.license).toBeNull();
    expect(created.compatibility).toBeNull();
    expect(created.createdByEmail).toBeUndefined();
    expect(created.createdByDisplayName).toBeUndefined();
    expect(created.releaseNotes).toBeNull();
    expect(created.isDeprecated).toBe(false);
    expect(created.deprecationNote).toBeNull();
    expect(created.agentsealScan).toBeNull();
    expect(created.createdOn).toBeInstanceOf(Date);
  });

  test("preserves the supplied optional fields", async () => {
    const created = await repo.create(
      createInput({
        license: "MIT",
        compatibility: "claude>=3",
        createdByEmail: "a@test.local",
        createdByDisplayName: "Author",
        releaseNotes: "first cut",
        createdOn: new Date("2026-02-02T00:00:00Z"),
      }),
    );
    expect(created.license).toBe("MIT");
    expect(created.compatibility).toBe("claude>=3");
    expect(created.createdByEmail).toBe("a@test.local");
    expect(created.createdByDisplayName).toBe("Author");
    expect(created.releaseNotes).toBe("first cut");
    expect(created.createdOn.toISOString()).toBe("2026-02-02T00:00:00.000Z");
  });

  test("a duplicate (skillGuid, version) throws SKILL_VERSION_EXISTS", async () => {
    await repo.create(createInput());
    let thrown: unknown;
    try {
      await repo.create(createInput());
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("SKILL_VERSION_EXISTS");
    expect((thrown as AppError).statusCode).toBe(409);
  });
});

describe("findBySkillAndVersion", () => {
  test("returns the matching version", async () => {
    await repo.create(createInput());
    const found = await repo.findBySkillAndVersion("skill-1", "1.0");
    expect(found).not.toBeNull();
    expect(found!._id).toBe("skill-1@1.0");
  });

  test("returns null when no row matches", async () => {
    expect(await repo.findBySkillAndVersion("skill-1", "9.9")).toBeNull();
  });
});

describe("findLatestBySkill / listBySkill ordering", () => {
  // Seed deliberately out of insertion order so the major/minor desc sort
  // is exercised rather than insertion order.
  async function seedThree(): Promise<void> {
    await repo.create(createInput({ version: "1.1", majorVersion: 1, minorVersion: 1 }));
    await repo.create(createInput({ version: "2.0", majorVersion: 2, minorVersion: 0 }));
    await repo.create(createInput({ version: "1.0", majorVersion: 1, minorVersion: 0 }));
  }

  test("findLatestBySkill returns the highest major/minor", async () => {
    await seedThree();
    const latest = await repo.findLatestBySkill("skill-1");
    expect(latest!.version).toBe("2.0");
  });

  test("findLatestBySkill returns null for an unknown skill", async () => {
    expect(await repo.findLatestBySkill("nope")).toBeNull();
  });

  test("listBySkill returns every version newest-first", async () => {
    await seedThree();
    const rows = await repo.listBySkill("skill-1");
    expect(rows.map((r) => r.version)).toEqual(["2.0", "1.1", "1.0"]);
  });

  test("listBySkill returns [] for an unknown skill", async () => {
    expect(await repo.listBySkill("nope")).toEqual([]);
  });
});

describe("deleteAllBySkill", () => {
  test("removes every version of the skill and returns the count", async () => {
    await repo.create(createInput({ version: "1.0", majorVersion: 1, minorVersion: 0 }));
    await repo.create(createInput({ version: "1.1", majorVersion: 1, minorVersion: 1 }));
    // A sibling skill must be untouched.
    await repo.create(
      createInput({ skillGuid: "skill-2", version: "1.0", majorVersion: 1, minorVersion: 0 }),
    );
    const deleted = await repo.deleteAllBySkill("skill-1");
    expect(deleted).toBe(2);
    expect(await repo.listBySkill("skill-1")).toEqual([]);
    expect(await repo.listBySkill("skill-2")).toHaveLength(1);
  });

  test("returns 0 when nothing matches", async () => {
    expect(await repo.deleteAllBySkill("nope")).toBe(0);
  });
});

describe("deleteOne", () => {
  test("returns true when the row existed", async () => {
    await repo.create(createInput());
    expect(await repo.deleteOne("skill-1", "1.0")).toBe(true);
    expect(await repo.findBySkillAndVersion("skill-1", "1.0")).toBeNull();
  });

  test("returns false when nothing was deleted", async () => {
    expect(await repo.deleteOne("skill-1", "1.0")).toBe(false);
  });
});

describe("setAgentsealScan", () => {
  test("persists the scan record on the version doc", async () => {
    await repo.create(createInput());
    const updated = await repo.setAgentsealScan("skill-1", "1.0", scanRecord);
    expect(updated).not.toBeNull();
    expect(updated!.agentsealScan).not.toBeNull();
    expect(updated!.agentsealScan!.score).toBe(88);
    expect(updated!.agentsealScan!.scannedFiles).toBe(4);
    expect(updated!.agentsealScan!.agentsealVersion).toBe("0.3.1");
  });

  test("returns null (no throw) when the version row is missing", async () => {
    expect(await repo.setAgentsealScan("skill-1", "9.9", scanRecord)).toBeNull();
  });

  test("mapScan coerces a malformed agentsealScan to null on read-back", async () => {
    // Seed a row whose agentsealScan is structurally broken (missing score).
    await seedRaw({
      _id: "skill-1@1.0",
      skillGuid: "skill-1",
      version: "1.0",
      majorVersion: 1,
      minorVersion: 0,
      storageKey: "skills/skill-1/1.0.zip",
      skillHash: "hash-10",
      metadata: META,
      createdBy: "user-1",
      createdOn: new Date(),
      agentsealScan: { findings: [], scannedAt: "x", agentsealVersion: "0.1" },
    });
    const found = await repo.findBySkillAndVersion("skill-1", "1.0");
    expect(found!.agentsealScan).toBeNull();
  });
});

describe("setDeprecation", () => {
  test("marks deprecated with a note", async () => {
    await repo.create(createInput());
    const updated = await repo.setDeprecation("skill-1", "1.0", true, "use 2.0 instead");
    expect(updated.isDeprecated).toBe(true);
    expect(updated.deprecationNote).toBe("use 2.0 instead");
  });

  test("marks deprecated with an explicit null note", async () => {
    await repo.create(createInput());
    const updated = await repo.setDeprecation("skill-1", "1.0", true, null);
    expect(updated.isDeprecated).toBe(true);
    expect(updated.deprecationNote).toBeNull();
  });

  test("un-deprecating clears any prior note", async () => {
    await repo.create(createInput());
    await repo.setDeprecation("skill-1", "1.0", true, "stale");
    const updated = await repo.setDeprecation("skill-1", "1.0", false, "ignored");
    expect(updated.isDeprecated).toBe(false);
    expect(updated.deprecationNote).toBeNull();
  });

  test("throws 404 skill_version_not_found for a missing row", async () => {
    let thrown: unknown;
    try {
      await repo.setDeprecation("skill-1", "9.9", true);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("skill_version_not_found");
    expect((thrown as AppError).statusCode).toBe(404);
  });
});
