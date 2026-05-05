/**
 * Integration tests for ActivityRepository against a real
 * mongodb-memory-server instance. The aggregation pipeline uses
 * `$push` + `$filter` + `$first` semantics that aren't worth mocking
 * — only the real engine verifies the "most-recent non-empty" pick
 * is correct.
 *
 * @module domains/admin/activityRepository.test
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ActivityRepository, type ActivityDocument } from "./activityRepository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: ActivityRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("activity-repo-test");
  repo = new ActivityRepository(db);
});

afterAll(async () => {
  await client.close().catch(() => {});
  await mongo.stop().catch(() => {});
});

beforeEach(async () => {
  await db.collection("activities").deleteMany({});
  await db.collection("skills").deleteMany({});
});

/**
 * Build a raw activity row. Bypasses `repo.log()` so the test can
 * choose `createdAt` directly — the aggregator's correctness depends
 * on the time-ordering of empty vs populated label rows.
 */
async function seed(rows: Array<Partial<ActivityDocument>>): Promise<void> {
  const docs: ActivityDocument[] = rows.map((r, i) => ({
    _id: r._id ?? `act-${i}`,
    userId: r.userId ?? "user-1",
    userEmail: r.userEmail ?? "",
    userDisplayName: r.userDisplayName ?? "",
    action: r.action ?? "login",
    details: r.details ?? {},
    createdAt: r.createdAt ?? new Date(),
  }));
  await db.collection<ActivityDocument>("activities").insertMany(docs);
}

describe("ActivityRepository.findByUserIds", () => {
  test("findByUserIds_MixedEmptyAndPopulated_PicksMostRecentNonEmpty", async () => {
    // Newest row has empty labels (e.g. admin login path); two earlier
    // rows have populated labels. The fix must skip the empty newest
    // row and pick the most-recent populated one.
    await seed([
      {
        _id: "old",
        userId: "u1",
        userEmail: "old@example.com",
        userDisplayName: "Old Name",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        _id: "mid",
        userId: "u1",
        userEmail: "mid@example.com",
        userDisplayName: "Mid Name",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
      {
        _id: "newest",
        userId: "u1",
        userEmail: "",
        userDisplayName: "",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
    ]);

    const result = await repo.findByUserIds(["u1"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      userId: "u1",
      email: "mid@example.com",
      displayName: "Mid Name",
    });
  });

  test("findByUserIds_AllEmptyHistory_ReturnsEmptyStrings", async () => {
    // Every row has empty labels (e.g. only-ever-logged-in-as-admin).
    // The aggregation produces null after `$first`-on-filtered, which
    // the API layer coerces to "". UI then renders the userId.
    await seed([
      { _id: "a", userId: "u-empty", userEmail: "", userDisplayName: "" },
      { _id: "b", userId: "u-empty", userEmail: "", userDisplayName: "" },
    ]);

    const result = await repo.findByUserIds(["u-empty"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      userId: "u-empty",
      email: "",
      displayName: "",
    });
  });

  test("findByUserIds_SingleRowWithValues_StillWorks", async () => {
    await seed([
      {
        _id: "only",
        userId: "u-solo",
        userEmail: "solo@example.com",
        userDisplayName: "Solo",
      },
    ]);

    const result = await repo.findByUserIds(["u-solo"]);
    expect(result).toEqual([
      {
        userId: "u-solo",
        email: "solo@example.com",
        displayName: "Solo",
      },
    ]);
  });

  test("findByUserIds_NewestRowOnlyMissingDisplayName_PicksPerFieldIndependently", async () => {
    // Newest row has the email but no displayName. Older row has
    // both. Each field's "most recent non-empty" pick runs
    // independently, so we should see the newest email + the older
    // displayName.
    await seed([
      {
        _id: "old",
        userId: "u-mix",
        userEmail: "old@example.com",
        userDisplayName: "Old Name",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        _id: "newest",
        userId: "u-mix",
        userEmail: "new@example.com",
        userDisplayName: "",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ]);

    const result = await repo.findByUserIds(["u-mix"]);
    expect(result[0]).toEqual({
      userId: "u-mix",
      email: "new@example.com",
      displayName: "Old Name",
    });
  });

  test("findByUserIds_EmptyInput_ReturnsEmptyArray", async () => {
    const result = await repo.findByUserIds([]);
    expect(result).toEqual([]);
  });
});

describe("ActivityRepository.aggregateUsers", () => {
  test("aggregateUsers_MixedEmptyAndPopulated_PicksMostRecentNonEmpty", async () => {
    await seed([
      {
        _id: "old",
        userId: "user-A",
        userEmail: "old@example.com",
        userDisplayName: "Old Name",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        _id: "newest",
        userId: "user-A",
        userEmail: "",
        userDisplayName: "",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
    ]);

    const skillCol = db.collection("skills");
    const result = await repo.aggregateUsers(skillCol, 1, 50);

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].userId).toBe("user-A");
    expect(result.items[0].email).toBe("old@example.com");
    expect(result.items[0].displayName).toBe("Old Name");
    expect(result.items[0].activityCount).toBe(2);
    // Newest row's createdAt drives lastActiveAt regardless of label content.
    expect(result.items[0].lastActiveAt).toBe("2026-03-01T00:00:00.000Z");
  });

  test("aggregateUsers_AllEmptyHistory_FallsThroughToEmptyStrings", async () => {
    await seed([
      { _id: "x", userId: "ghost", userEmail: "", userDisplayName: "" },
      { _id: "y", userId: "ghost", userEmail: "", userDisplayName: "" },
    ]);

    const skillCol = db.collection("skills");
    const result = await repo.aggregateUsers(skillCol, 1, 50);

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      userId: "ghost",
      email: "",
      displayName: "",
      activityCount: 2,
      skillCount: 0,
    });
  });

  test("aggregateUsers_SingleRowWithValues_ReturnsRowAsExpected", async () => {
    await seed([
      {
        _id: "only",
        userId: "alice",
        userEmail: "alice@example.com",
        userDisplayName: "Alice",
      },
    ]);

    const skillCol = db.collection("skills");
    const result = await repo.aggregateUsers(skillCol, 1, 50);

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      userId: "alice",
      email: "alice@example.com",
      displayName: "Alice",
      activityCount: 1,
    });
  });

  test("aggregateUsers_EnrichesSkillCountFromSkillCollection", async () => {
    await seed([
      {
        userId: "author-1",
        userEmail: "a1@example.com",
        userDisplayName: "Author One",
      },
    ]);

    const skillCol = db.collection("skills");
    await skillCol.insertMany([
      { _id: "s1", createdBy: "author-1", name: "skill-1" },
      { _id: "s2", createdBy: "author-1", name: "skill-2" },
      { _id: "s3", createdBy: "someone-else", name: "skill-3" },
    ] as never);

    const result = await repo.aggregateUsers(skillCol, 1, 50);
    const author = result.items.find((i) => i.userId === "author-1");
    expect(author).toBeDefined();
    expect(author!.skillCount).toBe(2);
  });

  test("aggregateUsers_PaginatesByLastActiveDesc", async () => {
    await seed([
      {
        userId: "u-old",
        userEmail: "old@example.com",
        userDisplayName: "Old",
        createdAt: new Date("2026-01-01"),
      },
      {
        userId: "u-new",
        userEmail: "new@example.com",
        userDisplayName: "New",
        createdAt: new Date("2026-06-01"),
      },
    ]);

    const skillCol = db.collection("skills");
    const result = await repo.aggregateUsers(skillCol, 1, 50);

    expect(result.items[0].userId).toBe("u-new");
    expect(result.items[1].userId).toBe("u-old");
  });
});
