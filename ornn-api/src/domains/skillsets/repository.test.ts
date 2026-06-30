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
    // Derived visibility (#1136) — the authoritative discovery key.
    memberVisibilityState: "all-public",
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

  test("listAllGuids returns every skillset's guid (#1136 backfill)", async () => {
    await seed(
      { _id: "ss-a", name: "a-set" },
      { _id: "ss-b", name: "b-set" },
      { _id: "ss-c", name: "c-set" },
    );
    const guids = await repo.listAllGuids();
    expect(guids.sort()).toEqual(["ss-a", "ss-b", "ss-c"]);
  });

  test("exportAsPlugin persists on create and round-trips (#1155)", async () => {
    await repo.create({
      guid: "ss-opt",
      name: "opt-set",
      description: "d",
      kind: "generic",
      tags: [],
      createdBy: "o",
      latestVersion: "1.0",
      exportAsPlugin: true,
    });
    expect((await repo.findByGuid("ss-opt"))?.exportAsPlugin).toBe(true);
  });

  test("exportAsPlugin defaults to false when omitted on create (#1155)", async () => {
    await repo.create({
      guid: "ss-def",
      name: "def-set",
      description: "d",
      kind: "generic",
      tags: [],
      createdBy: "o",
      latestVersion: "1.0",
    });
    expect((await repo.findByGuid("ss-def"))?.exportAsPlugin).toBe(false);
  });

  test("update flips exportAsPlugin only when an explicit value is given (#1155)", async () => {
    await repo.create({
      guid: "ss-u",
      name: "u-set",
      description: "d",
      kind: "generic",
      tags: [],
      createdBy: "o",
      latestVersion: "1.0",
      exportAsPlugin: true,
    });
    // A publish that omits the flag must preserve it.
    await repo.update("ss-u", { latestVersion: "1.1", updatedBy: "o" });
    expect((await repo.findByGuid("ss-u"))?.exportAsPlugin).toBe(true);
    // An explicit false turns it off.
    await repo.update("ss-u", { exportAsPlugin: false, updatedBy: "o" });
    expect((await repo.findByGuid("ss-u"))?.exportAsPlugin).toBe(false);
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

describe("SkillsetRepository — findAllEligibleForMirror (#1155)", () => {
  test("returns only all-public AND opted-in skillsets", async () => {
    await seed(
      { _id: "ok", name: "ok-set", memberVisibilityState: "all-public", exportAsPlugin: true },
      // opted in but not all-public → excluded (member content not safe to publish).
      { _id: "restr", name: "restr-set", memberVisibilityState: "restricted", exportAsPlugin: true },
      // all-public but not opted in → excluded (no consent).
      { _id: "noopt", name: "noopt-set", memberVisibilityState: "all-public", exportAsPlugin: false },
      // all-public, opt-in field absent (pre-feature doc) → excluded.
      { _id: "legacy", name: "legacy-set", memberVisibilityState: "all-public" },
    );
    const eligible = await repo.findAllEligibleForMirror();
    expect(eligible.map((s) => s.guid)).toEqual(["ok"]);
  });

  test("returns an empty list when nothing is eligible", async () => {
    await seed({ _id: "x", name: "x-set", memberVisibilityState: "all-public", exportAsPlugin: false });
    expect(await repo.findAllEligibleForMirror()).toEqual([]);
  });
});

describe("SkillsetRepository — findCheapScope (#1136 derived visibility)", () => {
  test("public scope returns only all-public skillsets (anon-safe)", async () => {
    await seed(
      { _id: "pub", name: "pub-set", memberVisibilityState: "all-public" },
      { _id: "restr", name: "restr-set", memberVisibilityState: "restricted" },
      { _id: "broken", name: "broken-set", memberVisibilityState: "unresolvable" },
    );
    const { skillsets, total } = await repo.findCheapScope("public", "", 1, 20);
    expect(total).toBe(1);
    expect(skillsets.map((s) => s.guid)).toEqual(["pub"]);
  });

  test("mine scope returns the caller's own skillsets in any visibility state", async () => {
    await seed(
      { _id: "mine-pub", name: "mp", createdBy: "u1", memberVisibilityState: "all-public" },
      { _id: "mine-restr", name: "mr", createdBy: "u1", memberVisibilityState: "restricted" },
      { _id: "mine-broken", name: "mb", createdBy: "u1", memberVisibilityState: "unresolvable" },
      { _id: "others", name: "o", createdBy: "other", memberVisibilityState: "all-public" },
    );
    const { skillsets } = await repo.findCheapScope("mine", "u1", 1, 20);
    expect(skillsets.map((s) => s.guid).sort()).toEqual(["mine-broken", "mine-pub", "mine-restr"]);
  });

  test("mine scope for an anonymous caller matches nothing", async () => {
    await seed({ _id: "x", name: "x", createdBy: "u1" });
    const { skillsets, total } = await repo.findCheapScope("mine", "", 1, 20);
    expect(total).toBe(0);
    expect(skillsets).toEqual([]);
  });

  test("kind filter narrows public results", async () => {
    await seed(
      { _id: "g", name: "g-set", kind: "generic" },
      { _id: "c", name: "c-set", kind: "consensus-supported" },
    );
    const { skillsets } = await repo.findCheapScope("public", "", 1, 20, {
      kind: "consensus-supported",
    });
    expect(skillsets.map((s) => s.guid)).toEqual(["c"]);
  });

  test("tags $all requires every listed tag", async () => {
    await seed(
      { _id: "ab", name: "ab-set", tags: ["a", "b"] },
      { _id: "a", name: "a-set", tags: ["a"] },
    );
    const { skillsets } = await repo.findCheapScope("public", "", 1, 20, {
      tagsAll: ["a", "b"],
    });
    expect(skillsets.map((s) => s.guid)).toEqual(["ab"]);
  });
});

describe("SkillsetRepository — findLiveScopeCandidates (#1136)", () => {
  test("shared-with-me returns restricted skillsets authored by others (live-checked downstream)", async () => {
    await seed(
      { _id: "mine-restr", name: "mr", createdBy: "u1", memberVisibilityState: "restricted" },
      { _id: "others-restr", name: "or", createdBy: "other", memberVisibilityState: "restricted" },
      { _id: "others-pub", name: "op", createdBy: "other", memberVisibilityState: "all-public" },
      { _id: "others-broken", name: "ob", createdBy: "other", memberVisibilityState: "unresolvable" },
    );
    const { candidates } = await repo.findLiveScopeCandidates("shared-with-me", "u1", undefined, 100);
    expect(candidates.map((s) => s.guid)).toEqual(["others-restr"]);
  });

  test("private returns the caller's own non-public + restricted-by-others", async () => {
    await seed(
      { _id: "mine-pub", name: "mp", createdBy: "u1", memberVisibilityState: "all-public" },
      { _id: "mine-restr", name: "mr", createdBy: "u1", memberVisibilityState: "restricted" },
      { _id: "mine-broken", name: "mb", createdBy: "u1", memberVisibilityState: "unresolvable" },
      { _id: "others-restr", name: "or", createdBy: "other", memberVisibilityState: "restricted" },
      { _id: "others-pub", name: "op", createdBy: "other", memberVisibilityState: "all-public" },
    );
    const { candidates } = await repo.findLiveScopeCandidates("private", "u1", undefined, 100);
    // mine-pub excluded (that's "public", not "private"); others-pub excluded.
    expect(candidates.map((s) => s.guid).sort()).toEqual(["mine-broken", "mine-restr", "others-restr"]);
  });

  test("mixed additionally includes all-public skillsets", async () => {
    await seed(
      { _id: "mine-restr", name: "mr", createdBy: "u1", memberVisibilityState: "restricted" },
      { _id: "others-restr", name: "or", createdBy: "other", memberVisibilityState: "restricted" },
      { _id: "others-pub", name: "op", createdBy: "other", memberVisibilityState: "all-public" },
      { _id: "others-broken", name: "ob", createdBy: "other", memberVisibilityState: "unresolvable" },
    );
    const { candidates } = await repo.findLiveScopeCandidates("mixed", "u1", undefined, 100);
    // unresolvable-by-others excluded (only owner sees those, via `mine`).
    expect(candidates.map((s) => s.guid).sort()).toEqual(["mine-restr", "others-pub", "others-restr"]);
  });

  test("reports capped=true when the candidate set is truncated", async () => {
    await seed(
      { _id: "r1", name: "r1", createdBy: "other", memberVisibilityState: "restricted" },
      { _id: "r2", name: "r2", createdBy: "other", memberVisibilityState: "restricted" },
      { _id: "r3", name: "r3", createdBy: "other", memberVisibilityState: "restricted" },
    );
    const { candidates, capped } = await repo.findLiveScopeCandidates("shared-with-me", "u1", undefined, 2);
    expect(candidates).toHaveLength(2);
    expect(capped).toBe(true);
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

describe("SkillsetVersionRepository — findSkillsetGuidsByMember (#1136)", () => {
  async function seedVersion(
    skillsetGuid: string,
    version: string,
    members: string[],
  ): Promise<void> {
    const [major, minor] = version.split(".").map(Number);
    await versionRepo.create({
      skillsetGuid,
      version,
      majorVersion: major ?? 1,
      minorVersion: minor ?? 0,
      kind: "generic",
      description: "d",
      instructions: "p",
      tags: [],
      members,
      createdBy: "owner-1",
    });
  }

  test("matches a member referenced by name or by guid, across ref grammars", async () => {
    // ss-a references the skill by name@version, ss-b by guid@version,
    // ss-c by name@dist-tag — all three must be found for skill `review`.
    await seedVersion("ss-a", "1.0", ["review@1.0", "other@1.0"]);
    await seedVersion("ss-b", "1.0", ["skl-review-guid@2.1"]);
    await seedVersion("ss-c", "1.0", ["review@latest"]);
    await seedVersion("ss-d", "1.0", ["unrelated@1.0"]);

    const guids = await versionRepo.findSkillsetGuidsByMember("review", "skl-review-guid");
    expect(guids.sort()).toEqual(["ss-a", "ss-b", "ss-c"]);
  });

  test("dedupes a skill referenced by multiple versions of the same skillset", async () => {
    await seedVersion("ss-x", "1.0", ["review@1.0"]);
    await seedVersion("ss-x", "1.1", ["review@1.1"]);
    await seedVersion("ss-x", "2.0", ["other@1.0"]);

    const guids = await versionRepo.findSkillsetGuidsByMember("review", "skl-review-guid");
    expect(guids).toEqual(["ss-x"]);
  });

  test("does not match a name that is only a prefix of another member ref", async () => {
    // `rev` must not match `review@1.0` — the `@` boundary in the regex
    // prevents prefix bleed.
    await seedVersion("ss-p", "1.0", ["review@1.0"]);
    const guids = await versionRepo.findSkillsetGuidsByMember("rev", "skl-rev-guid");
    expect(guids).toEqual([]);
  });

  test("escapes regex metacharacters in the skill name", async () => {
    // A name with a regex-special char must be matched literally, not as a pattern.
    await seedVersion("ss-r", "1.0", ["a.b+c@1.0"]);
    const guids = await versionRepo.findSkillsetGuidsByMember("a.b+c", "skl-dot-guid");
    expect(guids).toEqual(["ss-r"]);
    // The literal name must not act as a wildcard against a different ref.
    await seedVersion("ss-s", "1.0", ["axbxc@1.0"]);
    const again = await versionRepo.findSkillsetGuidsByMember("a.b+c", "skl-dot-guid");
    expect(again).toEqual(["ss-r"]);
  });

  test("returns empty when no version references the skill", async () => {
    await seedVersion("ss-z", "1.0", ["foo@1.0"]);
    const guids = await versionRepo.findSkillsetGuidsByMember("bar", "skl-bar-guid");
    expect(guids).toEqual([]);
  });
});
