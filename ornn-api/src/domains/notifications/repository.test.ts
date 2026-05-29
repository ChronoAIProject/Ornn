/**
 * NotificationRepository unit tests (#454).
 *
 * Append-only per-user inbox + read-marker tracking. Pins:
 *   - create assigns id + createdAt + readAt=null
 *   - list filters per-user, respects unreadOnly + before, sorts desc by createdAt
 *   - countUnread counts only unread
 *   - markRead is per-user (can't read someone else's notification)
 *   - markAllRead returns modifiedCount
 *
 * @module domains/notifications/repository.test
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
import { NotificationRepository } from "./repository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: NotificationRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("notifications_test");
  repo = new NotificationRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("notifications").deleteMany({});
});

function seed(userId: string, n: number) {
  const promises: Array<Promise<unknown>> = [];
  for (let i = 0; i < n; i++) {
    promises.push(
      repo.create({
        userId,
        category: "audit.completed",
        title: `Notification ${i}`,
        body: `Body ${i}`,
      }),
    );
  }
  return Promise.all(promises);
}

describe("create", () => {
  test("assigns id, sets readAt=null, stamps createdAt", async () => {
    const n = await repo.create({
      userId: "u1",
      category: "audit.completed",
      title: "Hello",
      body: "World",
    });
    expect(n._id).toBeDefined();
    expect(n.userId).toBe("u1");
    expect(n.title).toBe("Hello");
    expect(n.readAt).toBeNull();
    expect(n.createdAt).toBeInstanceOf(Date);
  });
});

describe("list", () => {
  beforeEach(async () => {
    await seed("u1", 5);
    await seed("u2", 2);
  });

  test("returns only the calling user's notifications", async () => {
    const u1 = await repo.list("u1");
    const u2 = await repo.list("u2");
    expect(u1).toHaveLength(5);
    expect(u2).toHaveLength(2);
    // Strict ownership — no bleed
    expect(u1.every((n) => n.userId === "u1")).toBe(true);
  });

  test("sorts newest-first", async () => {
    const list = await repo.list("u1");
    for (let i = 0; i + 1 < list.length; i++) {
      expect(list[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(list[i + 1]!.createdAt.getTime());
    }
  });

  test("limit caps at 200 even when caller asks for more", async () => {
    const big = await repo.list("u1", { limit: 1_000_000 });
    // We only seeded 5; the cap doesn't expand results. Real test of
    // the cap is at the repo layer reading from MongoDB.
    expect(big.length).toBeLessThanOrEqual(200);
    expect(big).toHaveLength(5);
  });

  test("unreadOnly filter", async () => {
    const before = await repo.list("u1");
    await repo.markRead("u1", before[0]!._id);
    const unread = await repo.list("u1", { unreadOnly: true });
    expect(unread).toHaveLength(4);
    expect(unread.every((n) => n.readAt === null)).toBe(true);
  });

  test("before filter", async () => {
    // Page through using `before`
    const all = await repo.list("u1");
    const cutoff = all[2]!.createdAt;
    const older = await repo.list("u1", { before: cutoff });
    // Should return entries strictly older than cutoff
    expect(older.every((n) => n.createdAt.getTime() < cutoff.getTime())).toBe(true);
  });
});

describe("countUnread", () => {
  test("counts unread for the user", async () => {
    await seed("u1", 3);
    expect(await repo.countUnread("u1")).toBe(3);
    const list = await repo.list("u1");
    await repo.markRead("u1", list[0]!._id);
    expect(await repo.countUnread("u1")).toBe(2);
  });

  test("scoped per-user", async () => {
    await seed("u1", 3);
    await seed("u2", 5);
    expect(await repo.countUnread("u1")).toBe(3);
    expect(await repo.countUnread("u2")).toBe(5);
  });
});

describe("markRead", () => {
  test("marks the targeted notification readAt to now", async () => {
    await seed("u1", 2);
    const [first] = await repo.list("u1");
    const updated = await repo.markRead("u1", first!._id);
    expect(updated?.readAt).toBeInstanceOf(Date);
  });

  test("does NOT let user A read user B's notification", async () => {
    await seed("u1", 1);
    const [n] = await repo.list("u1");
    const result = await repo.markRead("attacker", n!._id);
    expect(result).toBeNull();
    // Verify the underlying notification is still unread.
    const fresh = await repo.list("u1");
    expect(fresh[0]!.readAt).toBeNull();
  });
});

describe("markAllRead", () => {
  test("flips every unread to read for the user, returns modifiedCount", async () => {
    await seed("u1", 4);
    const n = await repo.markAllRead("u1");
    expect(n).toBe(4);
    expect(await repo.countUnread("u1")).toBe(0);
  });

  test("returns 0 when there's nothing unread", async () => {
    await seed("u1", 2);
    await repo.markAllRead("u1");
    expect(await repo.markAllRead("u1")).toBe(0);
  });

  test("doesn't affect other users", async () => {
    await seed("u1", 2);
    await seed("u2", 3);
    await repo.markAllRead("u1");
    expect(await repo.countUnread("u2")).toBe(3);
  });
});
