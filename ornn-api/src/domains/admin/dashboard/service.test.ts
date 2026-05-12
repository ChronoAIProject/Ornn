/**
 * AdminDashboardService against in-memory Mongo.
 *
 * Verifies the disjoint-partition rule for skill totals:
 *   system  = isSystemSkill: true
 *   public  = isPrivate: false ∧ isSystemSkill !== true
 *   private = isPrivate: true
 *
 * User totals come from the unified `users` directory (issue #271).
 * The `listRecentActivities` method was removed in #271 — the activity
 * feed lives in PostHog now and the admin UI deep-links there.
 *
 * @module domains/admin/dashboard/service.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { UserDirectoryRepository } from "../../users/repository";
import { AdminDashboardService } from "./service";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let service: AdminDashboardService;
let userDirectoryRepo: UserDirectoryRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("dashboard_test");
  userDirectoryRepo = new UserDirectoryRepository(db);
  await userDirectoryRepo.ensureIndexes();
  service = new AdminDashboardService({ db, userDirectoryRepo });
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("skills").deleteMany({});
  await db.collection("users").deleteMany({});
});

async function seedAdmin(userId: string) {
  await userDirectoryRepo.upsert({
    userId,
    email: `${userId}@x`,
    displayName: userId,
    isAdmin: true,
  });
}

async function seedNormal(userId: string) {
  await userDirectoryRepo.upsert({
    userId,
    email: `${userId}@x`,
    displayName: userId,
    isAdmin: false,
  });
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

describe("user totals: 3 admin + 7 normal = 10", () => {
  test("admin/normal split matches", async () => {
    for (let i = 0; i < 3; i++) await seedAdmin(`a${i}`);
    for (let i = 0; i < 7; i++) await seedNormal(`u${i}`);
    const s = await service.getStats();
    expect(s.users).toEqual({ total: 10, admin: 3, normal: 7 });
  });
});

describe("empty admin list", () => {
  test("admin=0 normal=total", async () => {
    for (let i = 0; i < 5; i++) await seedNormal(`u${i}`);
    const s = await service.getStats();
    expect(s.users).toEqual({ total: 5, admin: 0, normal: 5 });
  });
});

describe("skill counts: 4 system + 5 public + 6 private = 15", () => {
  test("disjoint partition sums to total", async () => {
    for (let i = 0; i < 4; i++) await seedSkill({ isSystemSkill: true, isPrivate: false });
    for (let i = 0; i < 5; i++) await seedSkill({ isSystemSkill: false, isPrivate: false });
    for (let i = 0; i < 6; i++) await seedSkill({ isSystemSkill: false, isPrivate: true });
    const s = await service.getStats();
    expect(s.skills).toEqual({ total: 15, system: 4, public: 5, private: 6 });
  });
});

describe("system filter is isSystemSkill:true", () => {
  test("only true matches; absent or false excluded", async () => {
    await seedSkill({ isSystemSkill: true, isPrivate: false, guid: "s1" });
    await seedSkill({ isPrivate: false, guid: "s2" });
    const s = await service.getStats();
    expect(s.skills.system).toBe(1);
  });
});

describe("public excludes system", () => {
  test("public-non-system count does not double-count system skills", async () => {
    await seedSkill({ isSystemSkill: true, isPrivate: false });
    await seedSkill({ isSystemSkill: false, isPrivate: false });
    await seedSkill({ isPrivate: false });
    const s = await service.getStats();
    expect(s.skills.system).toBe(1);
    expect(s.skills.public).toBe(2);
  });
});

describe("empty DB", () => {
  test("all zero", async () => {
    const s = await service.getStats();
    expect(s.users).toEqual({ total: 0, admin: 0, normal: 0 });
    expect(s.skills).toEqual({ total: 0, system: 0, public: 0, private: 0 });
  });
});
