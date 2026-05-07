/**
 * AdminUsersService UT-ADMIN-USERS-001..009 against in-memory Mongo.
 *
 * @module domains/admin-users/service.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { ActivityRepository } from "../admin/activityRepository";
import { AdminUsersRepository } from "./repository";
import { UsersMetaRepository } from "./usersMetaRepository";
import { AdminUsersService } from "./service";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let service: AdminUsersService;
let activityRepo: ActivityRepository;
let adminUsersRepo: AdminUsersRepository;
let metaRepo: UsersMetaRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("admin_users_svc_test");
  activityRepo = new ActivityRepository(db);
  adminUsersRepo = new AdminUsersRepository(db);
  await adminUsersRepo.ensureIndexes();
  metaRepo = new UsersMetaRepository(db);
  await metaRepo.ensureIndexes();
  service = new AdminUsersService({
    db,
    activityRepo,
    adminUsersRepo,
    usersMetaRepo: metaRepo,
  });
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("activities").deleteMany({});
  await db.collection("admin_users").deleteMany({});
  await db.collection("users_meta").deleteMany({});
  await db.collection("skills").deleteMany({});
});

async function seedUser(opts: {
  userId: string;
  isAdmin?: boolean;
  activities?: Array<{ at: Date; email?: string; name?: string }>;
  skills?: number;
}) {
  if (opts.isAdmin) {
    await adminUsersRepo.upsert({
      userId: opts.userId,
      email: `${opts.userId}@x`,
      displayName: opts.userId,
    });
  }
  for (const a of opts.activities ?? []) {
    await db.collection("activities").insertOne({
      _id: `${opts.userId}-${a.at.toISOString()}` as never,
      userId: opts.userId,
      userEmail: a.email ?? `${opts.userId}@x`,
      userDisplayName: a.name ?? opts.userId,
      action: "login",
      details: {},
      createdAt: a.at,
    });
  }
  for (let i = 0; i < (opts.skills ?? 0); i++) {
    await db.collection("skills").insertOne({
      _id: `${opts.userId}-skill-${i}` as never,
      name: `${opts.userId}-${i}`,
      createdBy: opts.userId,
      isPrivate: false,
    });
  }
}

describe("UT-ADMIN-USERS-001 role=admin returns admin set", () => {
  test("3 admins seeded → 3 rows", async () => {
    for (let i = 0; i < 3; i++) {
      await seedUser({
        userId: `a${i}`,
        isAdmin: true,
        activities: [{ at: new Date(Date.UTC(2026, 4, 1 + i)) }],
      });
    }
    for (let i = 0; i < 4; i++) {
      await seedUser({
        userId: `u${i}`,
        activities: [{ at: new Date(Date.UTC(2026, 4, 5)) }],
      });
    }
    const r = await service.listUsers({ role: "admin", page: 1, pageSize: 50 });
    expect(r.total).toBe(3);
    expect(r.items.every((row) => row.userId.startsWith("a"))).toBe(true);
  });
});

describe("UT-ADMIN-USERS-002 role=normal excludes admins", () => {
  test("normal pool = total − admin", async () => {
    for (let i = 0; i < 2; i++) {
      await seedUser({
        userId: `a${i}`,
        isAdmin: true,
        activities: [{ at: new Date() }],
      });
    }
    for (let i = 0; i < 5; i++) {
      await seedUser({
        userId: `u${i}`,
        activities: [{ at: new Date() }],
      });
    }
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 50 });
    expect(r.total).toBe(5);
  });
});

describe("UT-ADMIN-USERS-003 search by email substring", () => {
  test("q narrows to prefix match", async () => {
    await seedUser({
      userId: "alice",
      activities: [{ at: new Date(), email: "alice@example.com", name: "Alice" }],
    });
    await seedUser({
      userId: "bob",
      activities: [{ at: new Date(), email: "bob@example.com", name: "Bob" }],
    });
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 50, q: "ali" });
    expect(r.total).toBe(1);
    expect(r.items[0].email).toBe("alice@example.com");
  });
});

describe("UT-ADMIN-USERS-004 pagination", () => {
  test("page=2 pageSize=10 returns rows 11..20", async () => {
    for (let i = 0; i < 25; i++) {
      await seedUser({
        userId: `u${String(i).padStart(2, "0")}`,
        activities: [{ at: new Date(Date.UTC(2026, 4, 1 + (i % 28))) }],
      });
    }
    const r = await service.listUsers({ role: "normal", page: 2, pageSize: 10 });
    expect(r.total).toBe(25);
    expect(r.items.length).toBe(10);
    expect(r.totalPages).toBe(3);
  });
});

describe("UT-ADMIN-USERS-005 default sort lastActiveAt desc, nulls last", () => {
  test("most-recent first", async () => {
    await seedUser({
      userId: "old",
      activities: [{ at: new Date(Date.UTC(2026, 0, 1)) }],
    });
    await seedUser({
      userId: "new",
      activities: [{ at: new Date(Date.UTC(2026, 4, 1)) }],
    });
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 10 });
    expect(r.items[0].userId).toBe("new");
    expect(r.items[1].userId).toBe("old");
  });
});

describe("UT-ADMIN-USERS-006 lastActiveAt = MAX(activities.createdAt)", () => {
  test("multiple activities; lastActiveAt is the max", async () => {
    await seedUser({
      userId: "u1",
      activities: [
        { at: new Date(Date.UTC(2026, 0, 1)) },
        { at: new Date(Date.UTC(2026, 4, 15)) },
        { at: new Date(Date.UTC(2026, 2, 1)) },
      ],
    });
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 10 });
    expect(r.items[0].lastActiveAt).toBe("2026-05-15T00:00:00.000Z");
    expect(r.items[0].activityCount).toBe(3);
  });
});

describe("UT-ADMIN-USERS-008 skillCount = N owned", () => {
  test("createdBy match", async () => {
    await seedUser({
      userId: "u1",
      activities: [{ at: new Date() }],
      skills: 4,
    });
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 10 });
    expect(r.items[0].skillCount).toBe(4);
  });
});

describe("firstJoinedAt synthesized from earliest activity", () => {
  test("matches MIN(activities.createdAt)", async () => {
    await seedUser({
      userId: "u1",
      activities: [
        { at: new Date(Date.UTC(2026, 4, 1)) },
        { at: new Date(Date.UTC(2025, 11, 15)) },
      ],
    });
    const r = await service.listUsers({ role: "normal", page: 1, pageSize: 10 });
    expect(r.items[0].firstJoinedAt).toBe("2025-12-15T00:00:00.000Z");
  });
});
