/**
 * SkillRepository unit tests (#874).
 *
 * Backed by mongodb-memory-server (mirrors the notifications / audit
 * repository harness). The `skills` collection keys each skill by its
 * UUID-string `_id` (the public GUID). Pins the query surface that the
 * service + search + admin layers all lean on:
 *   - applyScope visibility matrix (public / private-author / shared-user /
 *     shared-org / mine / shared-with-me / anonymous)
 *   - keywordSearch (_id exact, name/desc regex, escapeRegex on `.*`)
 *   - applyExtraFilters (tagsAll $all, systemFilter only/exclude,
 *     nyxidServiceId, sharedWith*Any)
 *   - pagination skip/limit + countByScope
 *   - basic CRUD (create / findByGuid / findByName / update / hardDelete /
 *     clearSource) + invalid_skill_id guard
 *   - dist-tags set/delete (dotted path)
 *   - nyxid-service tie + findByNyxidService
 *   - mirror eligibility / sync-state / counts
 *   - all five aggregates
 *
 * @module domains/skills/crud/repository.test
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
import { SkillRepository } from "./repository";
import { AppError } from "../../../shared/types/index";
import type { SkillMetadata } from "../../../shared/types/index";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: SkillRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("skills_crud_test");
  repo = new SkillRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("skills").deleteMany({});
});

// ---- Fixtures --------------------------------------------------------

const META: SkillMetadata = { category: "plain", tags: ["alpha", "beta"] };

/**
 * Raw-seed a skill doc. The repo expects `_id` to carry the public GUID
 * string, mirroring production. Sensible defaults keep call sites terse;
 * any field can be overridden.
 */
function makeSkillDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date();
  return {
    _id: "guid-1",
    name: "demo-skill",
    description: "A demo skill for tests.",
    license: null,
    compatibility: null,
    metadata: META,
    skillHash: "hash-1",
    storageKey: "skills/guid-1/1.0.zip",
    createdBy: "owner-1",
    createdByEmail: "owner@test.local",
    createdByDisplayName: "Owner One",
    createdOn: now,
    updatedBy: "owner-1",
    updatedOn: now,
    isPrivate: true,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    latestVersion: "1.0",
    ...overrides,
  };
}

async function seed(...docs: Array<Record<string, unknown>>): Promise<void> {
  await db.collection("skills").insertMany(docs.map((d) => makeSkillDoc(d)) as never);
}

// ---- Basic CRUD ------------------------------------------------------

describe("create / findByGuid / findByName", () => {
  test("create persists and round-trips through mapDoc", async () => {
    const created = await repo.create({
      guid: "g-new",
      name: "new-skill",
      description: "fresh",
      metadata: META,
      skillHash: "h",
      storageKey: "skills/g-new/1.0.zip",
      createdBy: "owner-1",
      latestVersion: "1.0",
    });
    expect(created.guid).toBe("g-new");
    expect(created.isPrivate).toBe(true); // default
    expect(created.sharedWithUsers).toEqual([]);
    const found = await repo.findByGuid("g-new");
    expect(found!.name).toBe("new-skill");
  });

  test("create with source stamps the origin pointer", async () => {
    const created = await repo.create({
      guid: "g-src",
      name: "src-skill",
      description: "fresh",
      metadata: META,
      skillHash: "h",
      storageKey: "skills/g-src/1.0.zip",
      createdBy: "owner-1",
      latestVersion: "1.0",
      source: { type: "github", repo: "o/r", ref: "main", path: "" },
    });
    expect(created.source?.repo).toBe("o/r");
  });

  test("duplicate name → skill_name_exists conflict", async () => {
    await seed({ _id: "guid-1", name: "dup-name" });
    let thrown: unknown;
    try {
      await repo.create({
        guid: "g-2",
        name: "dup-name",
        description: "x",
        metadata: META,
        skillHash: "h",
        storageKey: "k",
        createdBy: "u",
        latestVersion: "1.0",
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("skill_name_exists");
  });

  test("findByName returns the matching skill", async () => {
    await seed({ _id: "guid-1", name: "by-name" });
    expect((await repo.findByName("by-name"))!.guid).toBe("guid-1");
    expect(await repo.findByName("missing")).toBeNull();
  });

  test("findByGuid throws invalid_skill_id on an empty guid", async () => {
    let thrown: unknown;
    try {
      await repo.findByGuid("");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("invalid_skill_id");
  });
});

describe("update / hardDelete / clearSource", () => {
  test("update mutates only the supplied fields", async () => {
    await seed({ _id: "guid-1", name: "before", description: "old", isPrivate: true });
    const updated = await repo.update("guid-1", {
      name: "after",
      isPrivate: false,
      sharedWithUsers: ["u-2"],
      updatedBy: "owner-1",
    });
    expect(updated.name).toBe("after");
    expect(updated.isPrivate).toBe(false);
    expect(updated.sharedWithUsers).toEqual(["u-2"]);
    // Untouched field preserved.
    expect(updated.description).toBe("old");
  });

  test("hardDelete removes the doc", async () => {
    await seed({ _id: "guid-1" });
    await repo.hardDelete("guid-1");
    expect(await repo.findByGuid("guid-1")).toBeNull();
  });

  test("clearSource unsets the source field", async () => {
    await seed({
      _id: "guid-1",
      source: { type: "github", repo: "o/r", ref: "main", path: "" },
    });
    const after = await repo.clearSource("guid-1", "owner-1");
    expect(after!.source).toBeUndefined();
  });
});

// ---- Dist-tags -------------------------------------------------------

describe("dist-tags", () => {
  test("setDistTag writes a dotted path and deleteDistTag removes it", async () => {
    await seed({ _id: "guid-1" });
    await repo.setDistTag("guid-1", "beta", "1.1");
    let doc = await repo.findByGuid("guid-1");
    expect(doc!.distTags).toEqual({ beta: "1.1" });
    await repo.deleteDistTag("guid-1", "beta");
    doc = await repo.findByGuid("guid-1");
    // mapDistTags collapses the now-empty object to undefined.
    expect(doc!.distTags).toBeUndefined();
  });
});

// ---- Scope visibility matrix ----------------------------------------

describe("findByScope / findAllByScope — visibility matrix", () => {
  // A small fixture covering each visibility branch.
  async function seedMatrix(): Promise<void> {
    await seed(
      { _id: "pub", name: "public-skill", isPrivate: false, createdBy: "author-x" },
      { _id: "mine", name: "my-private", isPrivate: true, createdBy: "me" },
      {
        _id: "shared-user",
        name: "shared-with-me-user",
        isPrivate: true,
        createdBy: "author-y",
        sharedWithUsers: ["me"],
      },
      {
        _id: "shared-org",
        name: "shared-with-org",
        isPrivate: true,
        createdBy: "author-z",
        sharedWithOrgs: ["org-A"],
      },
      {
        _id: "other-private",
        name: "not-visible",
        isPrivate: true,
        createdBy: "stranger",
      },
    );
  }

  test("public scope returns only public skills (anonymous ok)", async () => {
    await seedMatrix();
    const { skills, total } = await repo.findByScope("public", "", [], 1, 20);
    expect(total).toBe(1);
    expect(skills.map((s) => s.guid)).toEqual(["pub"]);
  });

  test("private scope returns author + shared-user + shared-org", async () => {
    await seedMatrix();
    const { skills } = await repo.findByScope("private", "me", ["org-A"], 1, 20);
    expect(new Set(skills.map((s) => s.guid))).toEqual(
      new Set(["mine", "shared-user", "shared-org"]),
    );
  });

  test("private scope for an anonymous caller matches nothing", async () => {
    await seedMatrix();
    const { total } = await repo.findByScope("private", "", [], 1, 20);
    expect(total).toBe(0);
  });

  test("mine scope returns only skills I authored", async () => {
    await seedMatrix();
    const { skills } = await repo.findByScope("mine", "me", ["org-A"], 1, 20);
    expect(skills.map((s) => s.guid)).toEqual(["mine"]);
  });

  test("mine scope for an anonymous caller matches nothing", async () => {
    await seedMatrix();
    const { total } = await repo.findByScope("mine", "", [], 1, 20);
    expect(total).toBe(0);
  });

  test("shared-with-me excludes my own authored skills", async () => {
    await seedMatrix();
    const { skills } = await repo.findByScope("shared-with-me", "me", ["org-A"], 1, 20);
    expect(new Set(skills.map((s) => s.guid))).toEqual(
      new Set(["shared-user", "shared-org"]),
    );
  });

  test("shared-with-me with no grants matches nothing", async () => {
    await seedMatrix();
    const { total } = await repo.findByScope("shared-with-me", "", [], 1, 20);
    expect(total).toBe(0);
  });

  test("mixed scope unions public + visible private", async () => {
    await seedMatrix();
    const { skills } = await repo.findByScope("mixed", "me", ["org-A"], 1, 20);
    expect(new Set(skills.map((s) => s.guid))).toEqual(
      new Set(["pub", "mine", "shared-user", "shared-org"]),
    );
  });

  test("findAllByScope (public) returns the projected docs unpaginated", async () => {
    await seedMatrix();
    const all = await repo.findAllByScope("public", "", []);
    expect(all.map((s) => s.guid)).toEqual(["pub"]);
  });

  test("restrictToGuids=[] short-circuits to empty without a query", async () => {
    await seedMatrix();
    const { skills, total } = await repo.findByScope("public", "", [], 1, 20, []);
    expect(skills).toEqual([]);
    expect(total).toBe(0);
  });

  test("restrictToGuids narrows the matched set", async () => {
    await seedMatrix();
    const { skills } = await repo.findByScope("mixed", "me", ["org-A"], 1, 20, ["pub"]);
    expect(skills.map((s) => s.guid)).toEqual(["pub"]);
  });
});

// ---- Pagination + countByScope --------------------------------------

describe("pagination + countByScope", () => {
  async function seedTen(): Promise<void> {
    const docs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 10; i++) {
      docs.push({
        _id: `pub-${i}`,
        name: `pub-${i}`,
        isPrivate: false,
        createdBy: "author-x",
        createdOn: new Date(2026, 0, i + 1),
      });
    }
    await seed(...docs);
  }

  test("skip/limit slice the result and report the unpaged total", async () => {
    await seedTen();
    const page1 = await repo.findByScope("public", "", [], 1, 3);
    expect(page1.skills).toHaveLength(3);
    expect(page1.total).toBe(10);
    const page2 = await repo.findByScope("public", "", [], 2, 3);
    expect(page2.skills).toHaveLength(3);
    // Pages are disjoint (sorted createdOn desc).
    const overlap = page1.skills
      .map((s) => s.guid)
      .filter((g) => page2.skills.some((s) => s.guid === g));
    expect(overlap).toEqual([]);
  });

  test("countByScope matches the unpaged total", async () => {
    await seedTen();
    expect(await repo.countByScope("public", "", [])).toBe(10);
  });

  test("countByScope short-circuits to 0 for an empty-match scope", async () => {
    await seedTen();
    expect(await repo.countByScope("mine", "", [])).toBe(0);
  });
});

// ---- keywordSearch ---------------------------------------------------

describe("keywordSearch", () => {
  async function seedSearch(): Promise<void> {
    await seed(
      { _id: "alpha-guid", name: "alpha-tool", description: "first thing", isPrivate: false, createdBy: "x" },
      { _id: "beta-guid", name: "beta-tool", description: "second thing", isPrivate: false, createdBy: "x" },
      { _id: "weird-guid", name: "weird.*name", description: "edge", isPrivate: false, createdBy: "x" },
    );
  }

  test("matches an exact _id", async () => {
    await seedSearch();
    const { skills } = await repo.keywordSearch("alpha-guid", "public", "", [], 1, 20);
    expect(skills.map((s) => s.guid)).toContain("alpha-guid");
  });

  test("matches a case-insensitive name regex", async () => {
    await seedSearch();
    const { skills } = await repo.keywordSearch("ALPHA", "public", "", [], 1, 20);
    expect(skills.map((s) => s.name)).toContain("alpha-tool");
  });

  test("matches a description regex", async () => {
    await seedSearch();
    const { skills } = await repo.keywordSearch("second", "public", "", [], 1, 20);
    expect(skills.map((s) => s.guid)).toEqual(["beta-guid"]);
  });

  test("treats a query with regex metacharacters literally (escapeRegex)", async () => {
    await seedSearch();
    // Un-escaped, `.*` is a catch-all that would match all three rows.
    // Escaped, it only matches the one name carrying the literal `.*`.
    const { skills } = await repo.keywordSearch(".*", "public", "", [], 1, 20);
    expect(skills.map((s) => s.guid)).toEqual(["weird-guid"]);
  });

  test("restrictToGuids=[] short-circuits to empty", async () => {
    await seedSearch();
    const { skills, total } = await repo.keywordSearch("alpha", "public", "", [], 1, 20, []);
    expect(skills).toEqual([]);
    expect(total).toBe(0);
  });
});

// ---- applyExtraFilters ----------------------------------------------

describe("applyExtraFilters", () => {
  async function seedFilters(): Promise<void> {
    await seed(
      {
        _id: "tagged",
        name: "tagged-skill",
        isPrivate: false,
        createdBy: "x",
        metadata: { category: "plain", tags: ["red", "blue"] },
      },
      {
        _id: "system",
        name: "system-skill",
        isPrivate: false,
        createdBy: "x",
        isSystemSkill: true,
        nyxidServiceId: "svc-1",
      },
      {
        _id: "plain-pub",
        name: "plain-pub",
        isPrivate: false,
        createdBy: "x",
      },
    );
  }

  test("tagsAll requires every requested tag ($all)", async () => {
    await seedFilters();
    const both = await repo.findByScope("public", "", [], 1, 20, undefined, {
      tagsAll: ["red", "blue"],
    });
    expect(both.skills.map((s) => s.guid)).toEqual(["tagged"]);
    const missing = await repo.findByScope("public", "", [], 1, 20, undefined, {
      tagsAll: ["red", "green"],
    });
    expect(missing.skills).toEqual([]);
  });

  test("systemFilter=only keeps just system skills", async () => {
    await seedFilters();
    const { skills } = await repo.findByScope("public", "", [], 1, 20, undefined, {
      systemFilter: "only",
    });
    expect(skills.map((s) => s.guid)).toEqual(["system"]);
  });

  test("systemFilter=exclude drops system skills", async () => {
    await seedFilters();
    const { skills } = await repo.findByScope("public", "", [], 1, 20, undefined, {
      systemFilter: "exclude",
    });
    expect(skills.map((s) => s.guid).sort()).toEqual(["plain-pub", "tagged"]);
  });

  test("nyxidServiceId narrows to a single service", async () => {
    await seedFilters();
    const { skills } = await repo.findByScope("public", "", [], 1, 20, undefined, {
      nyxidServiceId: "svc-1",
    });
    expect(skills.map((s) => s.guid)).toEqual(["system"]);
  });

  test("sharedWithOrgsAny / sharedWithUsersAny / createdByAny intersect", async () => {
    await seed(
      {
        _id: "org-shared",
        name: "org-shared",
        isPrivate: true,
        createdBy: "author-a",
        sharedWithOrgs: ["org-Q"],
        sharedWithUsers: ["u-q"],
      },
    );
    const byOrg = await repo.findByScope("private", "author-a", ["org-Q"], 1, 20, undefined, {
      sharedWithOrgsAny: ["org-Q"],
    });
    expect(byOrg.skills.map((s) => s.guid)).toEqual(["org-shared"]);
    const byUser = await repo.findByScope("private", "author-a", ["org-Q"], 1, 20, undefined, {
      sharedWithUsersAny: ["u-q"],
    });
    expect(byUser.skills.map((s) => s.guid)).toEqual(["org-shared"]);
    const byAuthor = await repo.findByScope("private", "author-a", ["org-Q"], 1, 20, undefined, {
      createdByAny: ["author-a"],
    });
    expect(byAuthor.skills.map((s) => s.guid)).toEqual(["org-shared"]);
  });
});

// ---- nyxid-service tie ----------------------------------------------

describe("setNyxidService / findByNyxidService", () => {
  test("tie sets the cached fields + optional privacy flip", async () => {
    await seed({ _id: "guid-1", isPrivate: true });
    const tied = await repo.setNyxidService("guid-1", {
      nyxidServiceId: "svc-9",
      nyxidServiceSlug: "svc-9-slug",
      nyxidServiceLabel: "Service 9",
      isSystemSkill: true,
      isPrivate: false,
      updatedBy: "admin-1",
    });
    expect(tied.nyxidServiceId).toBe("svc-9");
    expect(tied.isSystemSkill).toBe(true);
    expect(tied.isPrivate).toBe(false);
  });

  test("untie wipes the cached fields", async () => {
    await seed({
      _id: "guid-1",
      isPrivate: false,
      nyxidServiceId: "svc-9",
      isSystemSkill: true,
    });
    const untied = await repo.setNyxidService("guid-1", {
      nyxidServiceId: null,
      nyxidServiceSlug: null,
      nyxidServiceLabel: null,
      isSystemSkill: false,
      updatedBy: "admin-1",
    });
    expect(untied.nyxidServiceId).toBeNull();
    expect(untied.isSystemSkill).toBe(false);
  });

  test("findByNyxidService (public scope) returns public skills tied to it", async () => {
    await seed(
      { _id: "s1", name: "s1", isPrivate: false, createdBy: "x", nyxidServiceId: "svc-1", isSystemSkill: true },
      { _id: "s2", name: "s2", isPrivate: false, createdBy: "x", nyxidServiceId: "other" },
    );
    const { skills, total } = await repo.findByNyxidService("svc-1", "public", "", [], 1, 20);
    expect(total).toBe(1);
    expect(skills.map((s) => s.guid)).toEqual(["s1"]);
  });
});

// ---- Mirror group ----------------------------------------------------

describe("mirror eligibility + sync state + counts", () => {
  async function seedMirror(): Promise<void> {
    await seed(
      { _id: "pub-synced", name: "pub-synced", isPrivate: false, latestVersion: "1.0", createdOn: new Date(2026, 0, 1) },
      { _id: "pub-lagging", name: "pub-lagging", isPrivate: false, latestVersion: "2.0", createdOn: new Date(2026, 0, 2) },
      { _id: "pub-never", name: "pub-never", isPrivate: false, latestVersion: "1.0", createdOn: new Date(2026, 0, 3) },
      { _id: "priv-1", name: "priv-1", isPrivate: true, latestVersion: "1.0" },
    );
    await repo.setMirrorSyncState("pub-synced", {
      version: "1.0",
      syncedAt: new Date(),
      commitSha: "sha-synced",
    });
    await repo.setMirrorSyncState("pub-lagging", {
      version: "1.0", // lags behind latestVersion 2.0
      syncedAt: new Date(),
      commitSha: "sha-lag",
    });
  }

  test("findAllEligibleForMirror returns only public skills", async () => {
    await seedMirror();
    const eligible = await repo.findAllEligibleForMirror();
    expect(eligible.map((s) => s.guid).sort()).toEqual([
      "pub-lagging",
      "pub-never",
      "pub-synced",
    ]);
  });

  test("getMirrorCounts classifies synced / lagging / neverSynced", async () => {
    await seedMirror();
    const counts = await repo.getMirrorCounts();
    expect(counts.eligible).toBe(3);
    expect(counts.synced).toBe(1);
    expect(counts.lagging).toBe(1);
    expect(counts.neverSynced).toBe(1);
    expect(counts.oldestUnsyncedAt).toEqual(new Date(2026, 0, 3));
  });

  test("setMirrorSyncState(null) clears the stamp", async () => {
    await seedMirror();
    await repo.setMirrorSyncState("pub-synced", null);
    const doc = await repo.findByGuid("pub-synced");
    expect(doc!.mirrorSync).toBeUndefined();
  });

  test("setMirrorSyncStateBulk stamps + clears in one roundtrip", async () => {
    await seedMirror();
    await repo.setMirrorSyncStateBulk([
      { guid: "pub-never", state: { version: "1.0", syncedAt: new Date(), commitSha: "sha-new" } },
      { guid: "pub-lagging", state: null },
    ]);
    expect((await repo.findByGuid("pub-never"))!.mirrorSync?.commitSha).toBe("sha-new");
    expect((await repo.findByGuid("pub-lagging"))!.mirrorSync).toBeUndefined();
  });

  test("setMirrorSyncStateBulk is a no-op on an empty list", async () => {
    await expect(repo.setMirrorSyncStateBulk([])).resolves.toBeUndefined();
  });

  test("clearAllMirrorSyncStamps drops every stamp", async () => {
    await seedMirror();
    await repo.clearAllMirrorSyncStamps();
    expect((await repo.findByGuid("pub-synced"))!.mirrorSync).toBeUndefined();
    expect((await repo.findByGuid("pub-lagging"))!.mirrorSync).toBeUndefined();
  });

  test("clearMirrorSyncForIneligibleSkills only heals private skills", async () => {
    await seedMirror();
    // Force a stamp onto the private skill, then heal.
    await repo.setMirrorSyncState("priv-1", {
      version: "1.0",
      syncedAt: new Date(),
      commitSha: "sha-priv",
    });
    await repo.clearMirrorSyncForIneligibleSkills();
    expect((await repo.findByGuid("priv-1"))!.mirrorSync).toBeUndefined();
    // The public synced skill keeps its stamp.
    expect((await repo.findByGuid("pub-synced"))!.mirrorSync?.commitSha).toBe("sha-synced");
  });
});

// ---- Aggregates ------------------------------------------------------

describe("aggregates", () => {
  test("aggregateGrantsByOwner counts grantees on my skills", async () => {
    await seed(
      { _id: "a", name: "a", createdBy: "me", sharedWithOrgs: ["org-A"], sharedWithUsers: ["u-1"] },
      { _id: "b", name: "b", createdBy: "me", sharedWithOrgs: ["org-A"], sharedWithUsers: [] },
      { _id: "c", name: "c", createdBy: "other", sharedWithOrgs: ["org-Z"], sharedWithUsers: [] },
    );
    const res = await repo.aggregateGrantsByOwner("me");
    expect(res.orgs).toEqual([{ id: "org-A", skillCount: 2 }]);
    expect(res.users).toEqual([{ userId: "u-1", skillCount: 1 }]);
  });

  test("aggregateGrantsByOwner returns empty for a blank user", async () => {
    expect(await repo.aggregateGrantsByOwner("")).toEqual({ orgs: [], users: [] });
  });

  test("aggregateSourcesForReader counts visibility bridges", async () => {
    await seed(
      { _id: "x", name: "x", isPrivate: true, createdBy: "author-1", sharedWithOrgs: ["org-A"], sharedWithUsers: [] },
      { _id: "y", name: "y", isPrivate: true, createdBy: "author-2", sharedWithOrgs: [], sharedWithUsers: ["me"] },
    );
    const res = await repo.aggregateSourcesForReader("me", ["org-A"]);
    expect(res.orgs).toEqual([{ id: "org-A", skillCount: 1 }]);
    expect(res.users).toEqual([{ userId: "author-2", skillCount: 1 }]);
  });

  test("aggregateTagsByScope counts distinct tags within scope", async () => {
    await seed(
      { _id: "t1", name: "t1", isPrivate: false, createdBy: "x", metadata: { category: "plain", tags: ["red", "blue"] } },
      { _id: "t2", name: "t2", isPrivate: false, createdBy: "x", metadata: { category: "plain", tags: ["red"] } },
    );
    const tags = await repo.aggregateTagsByScope("public", "", []);
    const byName = Object.fromEntries(tags.map((t) => [t.name, t.count]));
    expect(byName.red).toBe(2);
    expect(byName.blue).toBe(1);
  });

  test("aggregateAuthorsByScope counts per author with cached label", async () => {
    await seed(
      { _id: "p1", name: "p1", isPrivate: false, createdBy: "author-1", createdByEmail: "a1@test.local", createdByDisplayName: "A1" },
      { _id: "p2", name: "p2", isPrivate: false, createdBy: "author-1", createdByEmail: "a1@test.local", createdByDisplayName: "A1" },
    );
    const authors = await repo.aggregateAuthorsByScope("public", "", []);
    expect(authors).toHaveLength(1);
    expect(authors[0]!.userId).toBe("author-1");
    expect(authors[0]!.count).toBe(2);
    expect(authors[0]!.email).toBe("a1@test.local");
  });

  test("aggregateSystemServices groups by tied service", async () => {
    await seed(
      { _id: "s1", name: "s1", isPrivate: false, createdBy: "x", isSystemSkill: true, nyxidServiceId: "svc-1", nyxidServiceSlug: "svc-1", nyxidServiceLabel: "Service 1" },
      { _id: "s2", name: "s2", isPrivate: false, createdBy: "x", isSystemSkill: true, nyxidServiceId: "svc-1", nyxidServiceSlug: "svc-1", nyxidServiceLabel: "Service 1" },
      { _id: "s3", name: "s3", isPrivate: false, createdBy: "x", isSystemSkill: false },
    );
    const services = await repo.aggregateSystemServices();
    expect(services).toHaveLength(1);
    expect(services[0]!.id).toBe("svc-1");
    expect(services[0]!.count).toBe(2);
    expect(services[0]!.label).toBe("Service 1");
  });
});
