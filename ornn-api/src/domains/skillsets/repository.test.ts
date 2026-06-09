/**
 * SkillsetRepository + SkillsetVersionRepository unit tests (#969).
 *
 * Backed by mongodb-memory-server, mirroring the skills repository
 * harness. Pins:
 *   - findByScope visibility (honors the shared applyScope matrix)
 *   - kind equality filter narrows
 *   - tags $all AND-match
 *   - append-only versions reject a duplicate `guid@version`
 *
 * @module domains/skillsets/repository.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { SkillsetRepository } from "./repository";
import { SkillsetVersionRepository } from "./skillsetVersionRepository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: SkillsetRepository;
let versionRepo: SkillsetVersionRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("skillsets_test");
  repo = new SkillsetRepository(db);
  versionRepo = new SkillsetVersionRepository(db);
  await repo.ensureIndexes();
  await versionRepo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("skillsets").deleteMany({});
  await db.collection("skillset_versions").deleteMany({});
});

function makeDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date();
  return {
    _id: "ss-1",
    name: "review-set",
    description: "a curated set",
    kind: "generic",
    tags: ["alpha", "beta"],
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

async function seed(...docs: Array<Record<string, unknown>>): Promise<void> {
  await db.collection("skillsets").insertMany(docs.map((d) => makeDoc(d)) as never);
}

describe("SkillsetRepository — CRUD", () => {
  test("create then findByGuid / findByName round-trips", async () => {
    await repo.create({
      guid: "ss-x",
      name: "my-set",
      description: "desc",
      kind: "consensus-supported",
      tags: ["x"],
      createdBy: "owner-1",
      latestVersion: "1.0",
    });
    const byGuid = await repo.findByGuid("ss-x");
    expect(byGuid?.name).toBe("my-set");
    expect(byGuid?.kind).toBe("consensus-supported");
    const byName = await repo.findByName("my-set");
    expect(byName?.guid).toBe("ss-x");
  });

  test("create rejects a duplicate name with skillset_name_exists", async () => {
    await repo.create({
      guid: "ss-1",
      name: "dup",
      description: "d",
      kind: "generic",
      tags: [],
      createdBy: "o",
      latestVersion: "1.0",
    });
    let code = "";
    try {
      await repo.create({
        guid: "ss-2",
        name: "dup",
        description: "d",
        kind: "generic",
        tags: [],
        createdBy: "o",
        latestVersion: "1.0",
      });
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe("skillset_name_exists");
  });
});

describe("SkillsetRepository — findByScope visibility", () => {
  test("anonymous public scope sees only public skillsets", async () => {
    await seed(
      { _id: "pub", name: "pub-set", isPrivate: false },
      { _id: "priv", name: "priv-set", isPrivate: true },
    );
    const { skillsets, total } = await repo.findByScope("public", "", [], 1, 20);
    expect(total).toBe(1);
    expect(skillsets.map((s) => s.guid)).toEqual(["pub"]);
  });

  test("private scope honors author + shared-user + shared-org grants", async () => {
    await seed(
      { _id: "mine", name: "mine-set", isPrivate: true, createdBy: "u1" },
      { _id: "shared-u", name: "su-set", isPrivate: true, createdBy: "other", sharedWithUsers: ["u1"] },
      { _id: "shared-o", name: "so-set", isPrivate: true, createdBy: "other", sharedWithOrgs: ["org-a"] },
      { _id: "hidden", name: "hidden-set", isPrivate: true, createdBy: "other" },
    );
    const { skillsets } = await repo.findByScope("private", "u1", ["org-a"], 1, 20);
    expect(skillsets.map((s) => s.guid).sort()).toEqual(["mine", "shared-o", "shared-u"]);
  });
});

describe("SkillsetRepository — kind + tags filters", () => {
  test("kind filter narrows", async () => {
    await seed(
      { _id: "g", name: "g-set", kind: "generic", isPrivate: false },
      { _id: "c", name: "c-set", kind: "consensus-supported", isPrivate: false },
    );
    const { skillsets } = await repo.findByScope("public", "", [], 1, 20, {
      kind: "consensus-supported",
    });
    expect(skillsets.map((s) => s.guid)).toEqual(["c"]);
  });

  test("tags $all requires every listed tag", async () => {
    await seed(
      { _id: "ab", name: "ab-set", tags: ["a", "b"], isPrivate: false },
      { _id: "a", name: "a-set", tags: ["a"], isPrivate: false },
    );
    const { skillsets } = await repo.findByScope("public", "", [], 1, 20, {
      tagsAll: ["a", "b"],
    });
    expect(skillsets.map((s) => s.guid)).toEqual(["ab"]);
  });
});

describe("SkillsetVersionRepository — append-only", () => {
  test("rejects a duplicate guid@version", async () => {
    const data = {
      skillsetGuid: "ss-1",
      version: "1.0",
      majorVersion: 1,
      minorVersion: 0,
      kind: "generic" as const,
      description: "d",
      instructions: "p",
      tags: [],
      members: ["a@1.0", "b@1.0"],
      createdBy: "owner-1",
    };
    await versionRepo.create(data);
    let code = "";
    try {
      await versionRepo.create(data);
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe("skillset_version_exists");
  });

  test("listBySkillset returns newest version first", async () => {
    for (const [version, major, minor] of [
      ["1.0", 1, 0],
      ["1.1", 1, 1],
      ["2.0", 2, 0],
    ] as const) {
      await versionRepo.create({
        skillsetGuid: "ss-1",
        version,
        majorVersion: major,
        minorVersion: minor,
        kind: "generic",
        description: "d",
        instructions: "p",
        tags: [],
        members: ["a@1.0", "b@1.0"],
        createdBy: "owner-1",
      });
    }
    const versions = await versionRepo.listBySkillset("ss-1");
    expect(versions.map((v) => v.version)).toEqual(["2.0", "1.1", "1.0"]);
    const latest = await versionRepo.findLatestBySkillset("ss-1");
    expect(latest?.version).toBe("2.0");
  });
});
