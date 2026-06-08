/**
 * SettingsRepository unit tests — per-section persistence in the
 * `platform_settings` collection.
 *
 * Uses `mongodb-memory-server` so the `upsert` with `$set` +
 * `$setOnInsert`, and the null-coalescing read defaults, run against a
 * real Mongo. The logic under test is the Mongo query and its document
 * shape, so a fake collection would test nothing meaningful.
 *
 * Covers:
 *   - getSection hit + miss + the null-coalescing defaults (value→null,
 *     updatedAt→epoch, updatedBy→"system" when fields are absent).
 *   - listSections returns every section row with the same defaults.
 *   - putSection: the `$setOnInsert` insert path (createdAt stamped,
 *     actor recorded) THEN the update path (value replaced, createdAt
 *     preserved, updatedBy/updatedAt advanced).
 *
 * @module domains/settings/repository.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document } from "mongodb";
import { SettingsRepository } from "./repository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: SettingsRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("settings_repo_test");
  repo = new SettingsRepository(db);
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("platform_settings").deleteMany({});
});

describe("SettingsRepository.getSection", () => {
  test("miss returns null", async () => {
    expect(await repo.getSection("playground")).toBeNull();
  });

  test("hit returns the stored payload + metadata", async () => {
    const at = new Date("2026-03-01T00:00:00.000Z");
    await db.collection("platform_settings").insertOne({
      _id: "playground" as unknown as Document["_id"],
      value: { defaultMonthlyQuota: 500 },
      updatedAt: at,
      updatedBy: "admin@test.local",
    });
    const got = await repo.getSection("playground");
    expect(got?._id).toBe("playground");
    expect(got?.value).toEqual({ defaultMonthlyQuota: 500 });
    expect(got?.updatedAt.getTime()).toBe(at.getTime());
    expect(got?.updatedBy).toBe("admin@test.local");
  });

  test("null-coalescing defaults when fields are absent", async () => {
    // A row with neither value, updatedAt, nor updatedBy.
    await db
      .collection("platform_settings")
      .insertOne({ _id: "mirror" as unknown as Document["_id"] });
    const got = await repo.getSection("mirror");
    expect(got?.value).toBeNull();
    expect(got?.updatedAt.getTime()).toBe(new Date(0).getTime());
    expect(got?.updatedBy).toBe("system");
  });
});

describe("SettingsRepository.listSections", () => {
  test("returns every section row with applied defaults", async () => {
    await db.collection("platform_settings").insertMany([
      {
        _id: "playground" as unknown as Document["_id"],
        value: { a: 1 },
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedBy: "u1",
      },
      // Bare row → defaults applied on read.
      { _id: "telemetry" as unknown as Document["_id"] },
    ]);
    const all = await repo.listSections();
    expect(all.map((s) => s._id).sort()).toEqual(["playground", "telemetry"]);
    const telemetry = all.find((s) => s._id === "telemetry")!;
    expect(telemetry.value).toBeNull();
    expect(telemetry.updatedBy).toBe("system");
    expect(telemetry.updatedAt.getTime()).toBe(new Date(0).getTime());
  });
});

describe("SettingsRepository.putSection", () => {
  test("$setOnInsert insert path then update path", async () => {
    type StoredRow = {
      value: Record<string, unknown>;
      updatedBy: string;
      createdAt: Date;
      updatedAt: Date;
    };
    const t1 = new Date("2026-01-01T00:00:00.000Z");
    // ── Insert path ──
    await repo.putSection("playground", { quota: 200 }, "admin@a", t1);
    const inserted = (await db
      .collection("platform_settings")
      .findOne({
        _id: "playground" as unknown as Document["_id"],
      })) as unknown as StoredRow;
    expect(inserted.value).toEqual({ quota: 200 });
    expect(inserted.updatedBy).toBe("admin@a");
    expect(inserted.createdAt.getTime()).toBe(t1.getTime());
    expect(inserted.updatedAt.getTime()).toBe(t1.getTime());

    // ── Update path ── ($setOnInsert is a no-op; createdAt preserved)
    const t2 = new Date("2026-02-01T00:00:00.000Z");
    await repo.putSection("playground", { quota: 999 }, "admin@b", t2);
    const updated = (await db
      .collection("platform_settings")
      .findOne({
        _id: "playground" as unknown as Document["_id"],
      })) as unknown as StoredRow;
    expect(updated.value).toEqual({ quota: 999 });
    expect(updated.updatedBy).toBe("admin@b");
    expect(updated.updatedAt.getTime()).toBe(t2.getTime());
    // createdAt is stamped once on insert and never bumped on update.
    expect(updated.createdAt.getTime()).toBe(t1.getTime());
    // Still exactly one row for this section.
    expect(
      await db
        .collection("platform_settings")
        .countDocuments({ _id: "playground" as unknown as Document["_id"] }),
    ).toBe(1);
  });
});
