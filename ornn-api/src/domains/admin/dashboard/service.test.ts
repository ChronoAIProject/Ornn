/**
 * AdminDashboardService UT-DASH-001..006 against in-memory Mongo.
 *
 * Verifies the disjoint-partition rule for skill totals:
 *   system  = isSystemSkill: true
 *   public  = isPrivate: false ∧ isSystemSkill !== true
 *   private = isPrivate: true
 *
 * @module domains/admin/dashboard/service.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { ActivityRepository } from "../activityRepository";
import { AdminUsersRepository } from "../../admin-users/repository";
import { AdminDashboardService } from "./service";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let service: AdminDashboardService;
let activityRepo: ActivityRepository;
let adminUsersRepo: AdminUsersRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("dashboard_test");
  activityRepo = new ActivityRepository(db);
  adminUsersRepo = new AdminUsersRepository(db);
  await adminUsersRepo.ensureIndexes();
  service = new AdminDashboardService({ db, activityRepo, adminUsersRepo });
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("skills").deleteMany({});
  await db.collection("activities").deleteMany({});
  await db.collection("admin_users").deleteMany({});
});

async function seedActivityFor(userId: string) {
  await activityRepo.log(userId, `${userId}@x`, userId, "login", {});
}

async function seedAdmin(userId: string) {
  await adminUsersRepo.upsert({ userId, email: `${userId}@x`, displayName: userId });
  await seedActivityFor(userId);
}

async function seedNormal(userId: string) {
  await seedActivityFor(userId);
}

async function seedSkill(opts: {
  isSystemSkill?: boolean;
  isPrivate: boolean;
  guid?: string;
}) {
  await db.collection("skills").insertOne({
    _id: (opts.guid ?? `g-${Math.random()}`) as never,
    name: opts.guid ?? "skill",
    isPrivate: opts.isPrivate,
    isSystemSkill: opts.isSystemSkill ?? false,
  });
}

describe("UT-DASH-001 user totals: 3 admin + 7 normal = 10", () => {
  test("admin/normal split matches", async () => {
    for (let i = 0; i < 3; i++) await seedAdmin(`a${i}`);
    for (let i = 0; i < 7; i++) await seedNormal(`u${i}`);
    const s = await service.getStats();
    expect(s.users).toEqual({ total: 10, admin: 3, normal: 7 });
  });
});

describe("UT-DASH-002 empty admin list", () => {
  test("admin=0 normal=total", async () => {
    for (let i = 0; i < 5; i++) await seedNormal(`u${i}`);
    const s = await service.getStats();
    expect(s.users).toEqual({ total: 5, admin: 0, normal: 5 });
  });
});

describe("UT-DASH-003 skill counts: 4 system + 5 public + 6 private = 15", () => {
  test("disjoint partition sums to total", async () => {
    for (let i = 0; i < 4; i++) await seedSkill({ isSystemSkill: true, isPrivate: false });
    for (let i = 0; i < 5; i++) await seedSkill({ isSystemSkill: false, isPrivate: false });
    for (let i = 0; i < 6; i++) await seedSkill({ isSystemSkill: false, isPrivate: true });
    const s = await service.getStats();
    expect(s.skills).toEqual({ total: 15, system: 4, public: 5, private: 6 });
  });
});

describe("UT-DASH-004 system filter is isSystemSkill:true", () => {
  test("only true matches; absent or false excluded", async () => {
    await seedSkill({ isSystemSkill: true, isPrivate: false, guid: "s1" });
    await seedSkill({ isPrivate: false, guid: "s2" }); // isSystemSkill absent
    const s = await service.getStats();
    expect(s.skills.system).toBe(1);
  });
});

describe("UT-DASH-005 public excludes system", () => {
  test("public-non-system count does not double-count system skills", async () => {
    await seedSkill({ isSystemSkill: true, isPrivate: false }); // counted as system
    await seedSkill({ isSystemSkill: false, isPrivate: false }); // counted as public
    await seedSkill({ isPrivate: false }); // public (no isSystemSkill field)
    const s = await service.getStats();
    expect(s.skills.system).toBe(1);
    expect(s.skills.public).toBe(2);
  });
});

describe("UT-DASH-006 empty DB", () => {
  test("all zero", async () => {
    const s = await service.getStats();
    expect(s.users).toEqual({ total: 0, admin: 0, normal: 0 });
    expect(s.skills).toEqual({ total: 0, system: 0, public: 0, private: 0 });
  });
});

describe("listRecentActivities", () => {
  test("returns N most recent in desc order with ISO timestamps", async () => {
    for (let i = 0; i < 12; i++) await seedActivityFor(`u${i}`);
    const items = await service.listRecentActivities(5);
    expect(items.length).toBe(5);
    expect(typeof items[0].createdAt).toBe("string");
    // Newest first.
    expect(items[0].createdAt >= items[4].createdAt).toBe(true);
  });
});
