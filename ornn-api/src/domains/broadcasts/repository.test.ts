/**
 * BroadcastRepository — persistence-layer tests against an in-memory
 * Mongo. Focused on the two behaviours that are easy to get wrong:
 *
 *   1. `(userId, broadcastId)` uniqueness — repeat markReads must
 *      collapse onto the existing row rather than inserting dupes.
 *   2. Cascade delete — `deleteAllForBroadcast` must remove every
 *      receipt for that broadcast and leave receipts for other
 *      broadcasts untouched.
 *
 * @module domains/broadcasts/repository.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { BroadcastRepository } from "./repository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: BroadcastRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("broadcasts_repo_test");
  repo = new BroadcastRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("broadcasts").deleteMany({});
  await db.collection("broadcast_read_receipts").deleteMany({});
});

const baseInput = {
  titleI18n: { en: "Hello", zh: "你好" },
  bodyMarkdownI18n: { en: "World", zh: "世界" },
  createdBy: "u-admin",
} as const;

describe("BroadcastRepository — broadcasts CRUD", () => {
  test("create + getById round-trips bilingual fields", async () => {
    const created = await repo.create(baseInput);
    expect(created.titleI18n).toEqual({ en: "Hello", zh: "你好" });
    expect(created.bodyMarkdownI18n).toEqual({ en: "World", zh: "世界" });
    expect(created.createdBy).toBe("u-admin");
    expect(created.updatedBy).toBe("u-admin");
    const reloaded = await repo.getById(created._id);
    expect(reloaded).toEqual(created);
  });

  test("listAll returns newest first", async () => {
    const a = await repo.create({ ...baseInput, titleI18n: { en: "a", zh: "a" } });
    // Force a measurable timestamp gap so the sort is deterministic.
    await db
      .collection("broadcasts")
      .updateOne({ _id: a._id }, { $set: { createdAt: new Date("2026-05-01T00:00:00Z") } });
    const b = await repo.create({ ...baseInput, titleI18n: { en: "b", zh: "b" } });
    await db
      .collection("broadcasts")
      .updateOne({ _id: b._id }, { $set: { createdAt: new Date("2026-05-10T00:00:00Z") } });
    const all = await repo.listAll();
    expect(all.map((d) => d.titleI18n.en)).toEqual(["b", "a"]);
  });

  test("update merges per-locale patches", async () => {
    const created = await repo.create(baseInput);
    const patched = await repo.update(created._id, {
      titleI18n: { en: "Hi" },
      updatedBy: "u-other",
    });
    expect(patched?.titleI18n).toEqual({ en: "Hi", zh: "你好" });
    expect(patched?.bodyMarkdownI18n).toEqual({ en: "World", zh: "世界" });
    expect(patched?.updatedBy).toBe("u-other");
  });

  test("update on missing id returns null", async () => {
    const result = await repo.update("does-not-exist", { updatedBy: "u" });
    expect(result).toBeNull();
  });

  test("delete returns true when row removed, false on miss", async () => {
    const created = await repo.create(baseInput);
    expect(await repo.delete(created._id)).toBe(true);
    expect(await repo.delete(created._id)).toBe(false);
  });
});

describe("BroadcastRepository — read receipts", () => {
  test("markRead is idempotent — same (userId, broadcastId) only inserts once", async () => {
    const b = await repo.create(baseInput);
    const first = await repo.markRead("u-1", b._id);
    const second = await repo.markRead("u-1", b._id);
    expect(second._id).toBe(first._id);
    expect(second.readAt.getTime()).toBe(first.readAt.getTime());
    expect(await repo.readCountForBroadcast(b._id)).toBe(1);
  });

  test("markRead unique index rejects parallel duplicates at the DB level", async () => {
    const b = await repo.create(baseInput);
    // Direct insert bypassing the repo to confirm the unique index is
    // enforced — guards against an accidental schema change that
    // silently drops the constraint.
    await db
      .collection("broadcast_read_receipts")
      .insertOne({ _id: "r1", userId: "u-1", broadcastId: b._id, readAt: new Date() });
    await expect(
      db
        .collection("broadcast_read_receipts")
        .insertOne({ _id: "r2", userId: "u-1", broadcastId: b._id, readAt: new Date() }),
    ).rejects.toBeDefined();
  });

  test("markRead from two different users yields two receipts", async () => {
    const b = await repo.create(baseInput);
    await repo.markRead("u-1", b._id);
    await repo.markRead("u-2", b._id);
    expect(await repo.readCountForBroadcast(b._id)).toBe(2);
  });

  test("markManyRead inserts only missing receipts", async () => {
    const b1 = await repo.create({ ...baseInput, titleI18n: { en: "b1", zh: "b1" } });
    const b2 = await repo.create({ ...baseInput, titleI18n: { en: "b2", zh: "b2" } });
    const b3 = await repo.create({ ...baseInput, titleI18n: { en: "b3", zh: "b3" } });
    await repo.markRead("u-1", b1._id);
    const inserted = await repo.markManyRead("u-1", [b1._id, b2._id, b3._id]);
    expect(inserted).toBe(2);
    expect(await repo.readCountForBroadcast(b1._id)).toBe(1);
    expect(await repo.readCountForBroadcast(b2._id)).toBe(1);
    expect(await repo.readCountForBroadcast(b3._id)).toBe(1);
  });

  test("markManyRead with empty input is a no-op", async () => {
    expect(await repo.markManyRead("u-1", [])).toBe(0);
  });

  test("deleteAllForBroadcast removes all receipts for that broadcast only", async () => {
    const b1 = await repo.create({ ...baseInput, titleI18n: { en: "b1", zh: "b1" } });
    const b2 = await repo.create({ ...baseInput, titleI18n: { en: "b2", zh: "b2" } });
    await repo.markRead("u-1", b1._id);
    await repo.markRead("u-2", b1._id);
    await repo.markRead("u-1", b2._id);
    const removed = await repo.deleteAllForBroadcast(b1._id);
    expect(removed).toBe(2);
    expect(await repo.readCountForBroadcast(b1._id)).toBe(0);
    expect(await repo.readCountForBroadcast(b2._id)).toBe(1);
  });

  test("unreadBroadcastIdsForUser returns ids the user has not read", async () => {
    const b1 = await repo.create({ ...baseInput, titleI18n: { en: "b1", zh: "b1" } });
    const b2 = await repo.create({ ...baseInput, titleI18n: { en: "b2", zh: "b2" } });
    const b3 = await repo.create({ ...baseInput, titleI18n: { en: "b3", zh: "b3" } });
    await repo.markRead("u-1", b2._id);
    const unread = await repo.unreadBroadcastIdsForUser("u-1");
    expect(unread.sort()).toEqual([b1._id, b3._id].sort());
  });

  test("hasUserReadBroadcastsMap maps read state per id", async () => {
    const b1 = await repo.create({ ...baseInput, titleI18n: { en: "b1", zh: "b1" } });
    const b2 = await repo.create({ ...baseInput, titleI18n: { en: "b2", zh: "b2" } });
    await repo.markRead("u-1", b1._id);
    const map = await repo.hasUserReadBroadcastsMap("u-1", [b1._id, b2._id]);
    expect(map[b1._id]).toBeInstanceOf(Date);
    expect(map[b2._id]).toBeUndefined();
  });

  test("readCountsForBroadcasts groups counts in a single query", async () => {
    const b1 = await repo.create({ ...baseInput, titleI18n: { en: "b1", zh: "b1" } });
    const b2 = await repo.create({ ...baseInput, titleI18n: { en: "b2", zh: "b2" } });
    const b3 = await repo.create({ ...baseInput, titleI18n: { en: "b3", zh: "b3" } });
    await repo.markRead("u-1", b1._id);
    await repo.markRead("u-2", b1._id);
    await repo.markRead("u-1", b2._id);
    const counts = await repo.readCountsForBroadcasts([b1._id, b2._id, b3._id]);
    expect(counts[b1._id]).toBe(2);
    expect(counts[b2._id]).toBe(1);
    expect(counts[b3._id]).toBeUndefined();
  });
});
