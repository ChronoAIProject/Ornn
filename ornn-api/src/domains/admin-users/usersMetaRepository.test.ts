/**
 * UsersMetaRepository UT-USERMETA-001..004 against in-memory Mongo.
 *
 * @module domains/admin-users/usersMetaRepository.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { ActivityRepository } from "../admin/activityRepository";
import { UsersMetaRepository } from "./usersMetaRepository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let activityRepo: ActivityRepository;
let metaRepo: UsersMetaRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("usersmeta_test");
  activityRepo = new ActivityRepository(db);
  metaRepo = new UsersMetaRepository(db);
  await metaRepo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("users_meta").deleteMany({});
  await db.collection("activities").deleteMany({});
});

async function logActivityAt(userId: string, when: Date, email = `${userId}@x`) {
  await db.collection("activities").insertOne({
    _id: `${userId}-${when.toISOString()}` as never,
    userId,
    userEmail: email,
    userDisplayName: userId,
    action: "login",
    details: {},
    createdAt: when,
  });
}

describe("UT-USERMETA-001 first call computes from earliest activity", () => {
  test("returns date and persists row", async () => {
    await logActivityAt("u1", new Date(Date.UTC(2026, 0, 15)));
    await logActivityAt("u1", new Date(Date.UTC(2026, 4, 1)));
    const row = await metaRepo.getOrCompute("u1");
    expect(row.firstJoinedAt?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    const persisted = await db
      .collection("users_meta")
      .findOne({ _id: "u1" as unknown as never });
    expect(persisted).not.toBeNull();
  });
});

describe("UT-USERMETA-002 subsequent reads cached", () => {
  test("after first compute, second call returns same persisted row even if new activities arrive", async () => {
    await logActivityAt("u1", new Date(Date.UTC(2026, 4, 1)));
    const first = await metaRepo.getOrCompute("u1");
    // Add an EARLIER activity — cached row keeps its computed value.
    await logActivityAt("u1", new Date(Date.UTC(2025, 11, 1)));
    const second = await metaRepo.getOrCompute("u1");
    expect(second.firstJoinedAt?.toISOString()).toBe(first.firstJoinedAt?.toISOString());
  });
});

describe("UT-USERMETA-003 no activities → null", () => {
  test("firstJoinedAt:null row written", async () => {
    const row = await metaRepo.getOrCompute("ghost");
    expect(row.firstJoinedAt).toBeNull();
    expect(row.email).toBe("");
    const persisted = await db
      .collection("users_meta")
      .findOne({ _id: "ghost" as unknown as never });
    expect(persisted?.firstJoinedAt).toBeNull();
  });
});

describe("UT-USERMETA-004 manual seed wins (used by migration)", () => {
  test("upsert preserves seeded value across getOrCompute", async () => {
    const seeded = new Date(Date.UTC(2024, 5, 1));
    await metaRepo.upsert({
      _id: "u1",
      firstJoinedAt: seeded,
      computedAt: new Date(),
      email: "u1@x",
      displayName: "U1",
    });
    // Even with later activities, getOrCompute returns the seeded row.
    await logActivityAt("u1", new Date(Date.UTC(2026, 4, 1)));
    const row = await metaRepo.getOrCompute("u1");
    expect(row.firstJoinedAt?.toISOString()).toBe(seeded.toISOString());
  });
});

describe("batchGetOrCompute order matches input", () => {
  test("3 ids → 3 rows in input order", async () => {
    void activityRepo;
    await logActivityAt("u1", new Date(Date.UTC(2026, 0, 1)));
    await logActivityAt("u3", new Date(Date.UTC(2026, 2, 1)));
    const rows = await metaRepo.batchGetOrCompute(["u1", "u2", "u3"]);
    expect(rows.map((r) => r._id)).toEqual(["u1", "u2", "u3"]);
    expect(rows[0].firstJoinedAt).not.toBeNull();
    expect(rows[1].firstJoinedAt).toBeNull();
    expect(rows[2].firstJoinedAt).not.toBeNull();
  });
});
