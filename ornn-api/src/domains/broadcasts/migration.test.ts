/**
 * Tests for the `recipientUserIds` boot backfill (#502).
 *
 * Uses `mongodb-memory-server` so the migration's actual `updateMany`
 * is exercised against a real Mongo. Covers the three scenarios that
 * matter:
 *
 *   1. Pre-#502 docs (no `recipientUserIds` key) are backfilled to
 *      explicit `null`.
 *   2. Docs already carrying a value (`null` or non-empty array) are
 *      left untouched.
 *   3. Re-running on a fully-migrated DB is a no-op.
 *
 * @module domains/broadcasts/migration.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document } from "mongodb";
import pino from "pino";
import { backfillBroadcastRecipientUserIds } from "./migration";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
const logger = pino({ level: "silent" });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("broadcasts_migration_test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("broadcasts").deleteMany({});
});

describe("backfillBroadcastRecipientUserIds", () => {
  test("sets recipientUserIds: null on every doc where the field is absent", async () => {
    await db.collection("broadcasts").insertMany([
      {
        _id: "b-1" as unknown as Document["_id"],
        titleI18n: { en: "a", zh: "甲" },
        bodyMarkdownI18n: { en: "x", zh: "x" },
        createdBy: "u-admin",
        updatedBy: "u-admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: "b-2" as unknown as Document["_id"],
        titleI18n: { en: "b", zh: "乙" },
        bodyMarkdownI18n: { en: "y", zh: "y" },
        createdBy: "u-admin",
        updatedBy: "u-admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await backfillBroadcastRecipientUserIds(db, logger);

    const docs = await db.collection("broadcasts").find({}).toArray();
    expect(docs).toHaveLength(2);
    for (const doc of docs) {
      // Field is now present with explicit null.
      expect("recipientUserIds" in doc).toBe(true);
      expect(doc.recipientUserIds).toBeNull();
    }
  });

  test("leaves docs that already carry recipientUserIds (null or array) untouched", async () => {
    await db.collection("broadcasts").insertMany([
      {
        _id: "b-null" as unknown as Document["_id"],
        titleI18n: { en: "a", zh: "甲" },
        bodyMarkdownI18n: { en: "x", zh: "x" },
        createdBy: "u-admin",
        updatedBy: "u-admin",
        recipientUserIds: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: "b-targeted" as unknown as Document["_id"],
        titleI18n: { en: "b", zh: "乙" },
        bodyMarkdownI18n: { en: "y", zh: "y" },
        createdBy: "u-admin",
        updatedBy: "u-admin",
        recipientUserIds: ["u-1", "u-2"],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await backfillBroadcastRecipientUserIds(db, logger);

    const nullDoc = await db
      .collection("broadcasts")
      .findOne({ _id: "b-null" as unknown as Document["_id"] });
    const targetedDoc = await db
      .collection("broadcasts")
      .findOne({ _id: "b-targeted" as unknown as Document["_id"] });
    expect(nullDoc?.recipientUserIds).toBeNull();
    expect(targetedDoc?.recipientUserIds).toEqual(["u-1", "u-2"]);
  });

  test("is idempotent — second run on an already-migrated DB is a no-op", async () => {
    await db.collection("broadcasts").insertOne({
      _id: "b-1" as unknown as Document["_id"],
      titleI18n: { en: "a", zh: "甲" },
      bodyMarkdownI18n: { en: "x", zh: "x" },
      createdBy: "u-admin",
      updatedBy: "u-admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await backfillBroadcastRecipientUserIds(db, logger);
    // Capture the updatedAt-equivalent: doc field set.
    const first = await db
      .collection("broadcasts")
      .findOne({ _id: "b-1" as unknown as Document["_id"] });
    expect(first?.recipientUserIds).toBeNull();

    // Second run — should match zero docs since the field is now present.
    await backfillBroadcastRecipientUserIds(db, logger);
    const second = await db
      .collection("broadcasts")
      .findOne({ _id: "b-1" as unknown as Document["_id"] });
    expect(second?.recipientUserIds).toBeNull();
  });

  test("no-op on an empty broadcasts collection", async () => {
    await backfillBroadcastRecipientUserIds(db, logger);
    expect(await db.collection("broadcasts").countDocuments()).toBe(0);
  });
});
