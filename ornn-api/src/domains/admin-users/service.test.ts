/**
 * AdminUsersService against in-memory Mongo.
 *
 * After issue #271 the source pool is the unified `users` directory
 * (UserDirectoryRepository); the old `activities` aggregation is gone.
 * `lastActiveAt` and `firstJoinedAt` are surfaced from the directory's
 * `lastSeenAt` / `firstSeenAt` columns. `activityCount` is the
 * number of authenticated requests Ornn has seen for the user
 * (incremented on every directory upsert).
 *
 * @module domains/admin-users/service.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { UserDirectoryRepository } from "../users/repository";
import { AdminUsersService } from "./service";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let service: AdminUsersService;
let userDirectoryRepo: UserDirectoryRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("admin_users_svc_test");
  userDirectoryRepo = new UserDirectoryRepository(db);
  await userDirectoryRepo.ensureIndexes();
  service = new AdminUsersService({ db, userDirectoryRepo });
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("users").deleteMany({});
  await db.collection("skills").deleteMany({});
});

/**
 * Direct collection insert so tests can pin `firstSeenAt` / `lastSeenAt`
 * to specific dates. The lazy upsert path stamps `now` and would make
 * temporal assertions unreliable.
 */
async function seedUser(opts: {
  userId: string;
  isAdmin?: boolean;
  email?: string;
  displayName?: string;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  activityCount?: number;
  skills?: number;
}) {
  await db.collection("users").insertOne({
    _id: opts.userId as never,
    email: opts.email ?? `${opts.userId}@x`,
    displayName: opts.displayName ?? opts.userId,
    firstSeenAt: opts.firstSeenAt ?? new Date(),
    lastSeenAt: opts.lastSeenAt ?? new Date(),
    activityCount: opts.activityCount ?? 1,
    isAdmin: !!opts.isAdmin,
  });
  for (let i = 0; i < (opts.skills ?? 0); i++) {
    await db.collection("skills").insertOne({
      _id: `${opts.userId}-skill-${i}` as never,
      name: `${opts.userId}-${i}`,
      createdBy: opts.userId,
      isPrivate: false,
    });
  }
}

describe("role=admin returns admin set", () => {
  test("3 admins seeded → 3 rows", async () => {
    for (let i = 0; i < 3; i++) {
      await seedUser({
        userId: `a${i}`,
        isAdmin: true,
        lastSeenAt: new Date(Date.UTC(2026, 4, 1 + i)),
      });
    }
    for (let i = 0; i < 4; i++) {
      await seedUser({
        userId: `u${i}`,
        lastSeenAt: new Date(Date.UTC(2026, 4, 5)),
      });
    }
    const r = await service.listUsers({ role: "admin", page: 1, pageSize: 50 });
    expect(r.total).toBe(3);
    expect(r.items.every((row) => row.userId.startsWith("a"))).toBe(true);
  });
});

describe("role=normal excludes admins", () => {
  test("normal pool = total − admin", async () => {
    for (let i = 0; i < 2; i++) {
      await seedUser({ userId: `a${i}`, isAdmin: true });
    }
    for (let i = 0; i < 5; i++) {
      await seedUser({ userId: `u${i}` });
    }
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 50 });
    expect(r.total).toBe(5);
  });
});

describe("search by email prefix", () => {
  test("q narrows to prefix match", async () => {
    await seedUser({ userId: "alice", email: "alice@example.com", displayName: "Alice" });
    await seedUser({ userId: "bob", email: "bob@example.com", displayName: "Bob" });
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 50, q: "ali" });
    expect(r.total).toBe(1);
    expect(r.items[0]!.email).toBe("alice@example.com");
  });
});

describe("pagination", () => {
  test("page=2 pageSize=10 returns the second page", async () => {
    for (let i = 0; i < 25; i++) {
      await seedUser({
        userId: `u${String(i).padStart(2, "0")}`,
        lastSeenAt: new Date(Date.UTC(2026, 4, 1 + (i % 28))),
      });
    }
    const r = await service.listUsers({ role: "normal", page: 2, pageSize: 10 });
    expect(r.total).toBe(25);
    expect(r.items.length).toBe(10);
    expect(r.totalPages).toBe(3);
  });
});

describe("default sort lastActiveAt desc, nulls last", () => {
  test("most-recent first", async () => {
    await seedUser({
      userId: "old",
      lastSeenAt: new Date(Date.UTC(2026, 0, 1)),
    });
    await seedUser({
      userId: "new",
      lastSeenAt: new Date(Date.UTC(2026, 4, 1)),
    });
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 10 });
    expect(r.items[0]!.userId).toBe("new");
    expect(r.items[1]!.userId).toBe("old");
  });
});

describe("lastActiveAt surfaces directory's lastSeenAt", () => {
  test("ISO timestamp matches the seeded value", async () => {
    await seedUser({
      userId: "u1",
      lastSeenAt: new Date(Date.UTC(2026, 4, 15)),
      activityCount: 7,
    });
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 10 });
    expect(r.items[0]!.lastActiveAt).toBe("2026-05-15T00:00:00.000Z");
    expect(r.items[0]!.activityCount).toBe(7);
  });
});

describe("skillCount = N owned", () => {
  test("createdBy match", async () => {
    await seedUser({ userId: "u1", skills: 4 });
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 10 });
    expect(r.items[0]!.skillCount).toBe(4);
  });
});

describe("firstJoinedAt surfaces directory's firstSeenAt", () => {
  test("matches the seeded value", async () => {
    await seedUser({
      userId: "u1",
      firstSeenAt: new Date(Date.UTC(2025, 11, 15)),
    });
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 10 });
    expect(r.items[0]!.firstJoinedAt).toBe("2025-12-15T00:00:00.000Z");
  });
});
