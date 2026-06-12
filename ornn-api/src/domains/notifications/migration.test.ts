/**
 * Tests for the legacy-category cleanup boot migration (#218).
 *
 * Uses `mongodb-memory-server` so the migration's actual query semantics
 * — `$nin` filter, the count-first short-circuit, the `$group` aggregate
 * sample, and `deleteMany` — run against a real Mongo rather than a hand
 * stub. The logic under test IS the query, so a fake collection would
 * test nothing meaningful.
 *
 * Covers:
 *   1. Empty collection → no-op, deletes nothing (count-first branch).
 *   2. Mixed legacy `share.*` rows + current-vocabulary rows → only the
 *      legacy rows are deleted; current rows survive; the sample/aggregate
 *      logging branch runs (candidateCount > 0).
 *   3. Idempotent re-run → second pass matches zero rows and deletes none.
 *
 * @module domains/notifications/migration.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document } from "mongodb";
import { dropLegacyNotificationCategories } from "./migration";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("notifications_migration_test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("notifications").deleteMany({});
});

function makeRow(id: string, category: string): Document {
  return {
    _id: id as unknown as Document["_id"],
    userId: "u-1",
    category,
    title: `row ${id}`,
    data: {},
    readAt: null,
    createdAt: new Date(),
  };
}

describe("dropLegacyNotificationCategories", () => {
  test("no-op on an empty notifications collection", async () => {
    await dropLegacyNotificationCategories(db);
    expect(await db.collection("notifications").countDocuments()).toBe(0);
  });

  test("deletes only out-of-vocabulary rows; current categories survive", async () => {
    await db.collection("notifications").insertMany([
      // Legacy / dead categories — must be deleted.
      makeRow("legacy-1", "share.needs_justification"),
      makeRow("legacy-2", "share.needs_justification"),
      makeRow("legacy-3", "share.granted"),
      // Current vocabulary — must survive.
      makeRow("keep-1", "audit.completed"),
      makeRow("keep-2", "audit.risky_for_consumer"),
      makeRow("keep-3", "quota.credits_granted"),
    ]);

    await dropLegacyNotificationCategories(db);

    const remaining = await db
      .collection("notifications")
      .find({})
      .sort({ _id: 1 })
      .toArray();
    expect(remaining.map((d) => String(d._id)).sort()).toEqual([
      "keep-1",
      "keep-2",
      "keep-3",
    ]);
    // Every survivor is in the allowed vocabulary.
    for (const doc of remaining) {
      expect([
        "audit.completed",
        "audit.risky_for_consumer",
        "quota.credits_granted",
      ]).toContain(doc.category);
    }
  });

  test("is idempotent — a second run on the cleaned DB deletes nothing", async () => {
    await db.collection("notifications").insertMany([
      makeRow("legacy-1", "share.needs_justification"),
      makeRow("keep-1", "audit.completed"),
    ]);

    // First run removes the single legacy row.
    await dropLegacyNotificationCategories(db);
    expect(await db.collection("notifications").countDocuments()).toBe(1);

    // Second run hits the count-first short-circuit (zero candidates) and
    // leaves the current row untouched.
    await dropLegacyNotificationCategories(db);
    const remaining = await db.collection("notifications").find({}).toArray();
    expect(remaining).toHaveLength(1);
    expect(String(remaining[0]?._id)).toBe("keep-1");
  });
});
