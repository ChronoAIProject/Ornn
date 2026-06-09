/**
 * Tests for the announcements bilingual boot backfill.
 *
 * Uses `mongodb-memory-server` so the migration's actual `$ifNull`
 * aggregate-pipeline `updateMany` runs against a real Mongo. Covers:
 *
 *   1. Legacy single-locale docs (`title` / `bodyMarkdown` / `ctaLabel`)
 *      are backfilled into the `*En` / `*Zh` slots — including the
 *      `ctaLabel` null branch of the `$ifNull` pipeline.
 *   2. Already-migrated docs (`titleEn` present) are left untouched.
 *   3. Re-running on a fully-migrated DB is a no-op.
 *   4. Empty collection → no-op.
 *   5. Injected-failure arm: a rejecting `updateMany` is caught + logged
 *      and the migration returns rather than throwing.
 *
 * @module domains/announcements/migration.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document } from "mongodb";
import pino from "pino";
import { migrateAnnouncementsToBilingual } from "./migration";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
const logger = pino({ level: "silent" });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("announcements_migration_test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("announcements").deleteMany({});
});

describe("migrateAnnouncementsToBilingual", () => {
  test("backfills *En/*Zh from legacy single-locale fields (ctaLabel set)", async () => {
    await db.collection("announcements").insertOne({
      _id: "a-cta" as unknown as Document["_id"],
      title: "Legacy title",
      bodyMarkdown: "Legacy body",
      ctaLabel: "Legacy CTA",
      enabled: true,
      startsAt: null,
      endsAt: null,
      createdBy: "admin1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await migrateAnnouncementsToBilingual(db, logger);

    const doc = await db
      .collection("announcements")
      .findOne({ _id: "a-cta" as unknown as Document["_id"] });
    expect(doc?.titleEn).toBe("Legacy title");
    expect(doc?.titleZh).toBe("Legacy title");
    expect(doc?.bodyMarkdownEn).toBe("Legacy body");
    expect(doc?.bodyMarkdownZh).toBe("Legacy body");
    expect(doc?.ctaLabelEn).toBe("Legacy CTA");
    expect(doc?.ctaLabelZh).toBe("Legacy CTA");
  });

  test("ctaLabel null branch of the $ifNull pipeline → ctaLabel*: null", async () => {
    await db.collection("announcements").insertOne({
      _id: "a-nocta" as unknown as Document["_id"],
      title: "No CTA title",
      bodyMarkdown: "Body",
      // No ctaLabel key → $ifNull falls back to the null literal.
      enabled: false,
      startsAt: null,
      endsAt: null,
      createdBy: "admin1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await migrateAnnouncementsToBilingual(db, logger);

    const doc = await db
      .collection("announcements")
      .findOne({ _id: "a-nocta" as unknown as Document["_id"] });
    expect(doc?.titleEn).toBe("No CTA title");
    expect(doc?.ctaLabelEn).toBeNull();
    expect(doc?.ctaLabelZh).toBeNull();
  });

  test("leaves already-migrated docs (titleEn present) untouched", async () => {
    await db.collection("announcements").insertOne({
      _id: "a-done" as unknown as Document["_id"],
      title: "old",
      bodyMarkdown: "old body",
      ctaLabel: "old cta",
      titleEn: "EN title",
      titleZh: "ZH title",
      bodyMarkdownEn: "EN body",
      bodyMarkdownZh: "ZH body",
      ctaLabelEn: "EN cta",
      ctaLabelZh: "ZH cta",
      enabled: true,
      startsAt: null,
      endsAt: null,
      createdBy: "admin1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await migrateAnnouncementsToBilingual(db, logger);

    const doc = await db
      .collection("announcements")
      .findOne({ _id: "a-done" as unknown as Document["_id"] });
    // Not overwritten with the legacy `title`.
    expect(doc?.titleEn).toBe("EN title");
    expect(doc?.titleZh).toBe("ZH title");
    expect(doc?.ctaLabelEn).toBe("EN cta");
  });

  test("is idempotent — second run on a migrated DB is a no-op", async () => {
    await db.collection("announcements").insertOne({
      _id: "a-idem" as unknown as Document["_id"],
      title: "T",
      bodyMarkdown: "B",
      ctaLabel: null,
      enabled: true,
      startsAt: null,
      endsAt: null,
      createdBy: "admin1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await migrateAnnouncementsToBilingual(db, logger);
    const first = await db
      .collection("announcements")
      .findOne({ _id: "a-idem" as unknown as Document["_id"] });
    expect(first?.titleEn).toBe("T");

    await migrateAnnouncementsToBilingual(db, logger);
    const second = await db
      .collection("announcements")
      .findOne({ _id: "a-idem" as unknown as Document["_id"] });
    expect(second?.titleEn).toBe("T");
  });

  test("no-op on an empty announcements collection", async () => {
    await migrateAnnouncementsToBilingual(db, logger);
    expect(await db.collection("announcements").countDocuments()).toBe(0);
  });

  test("injected-failure arm: rejecting updateMany is caught, returns without throwing", async () => {
    const failingDb = {
      collection: () => ({
        updateMany: () => Promise.reject(new Error("mongo unavailable")),
      }),
    } as unknown as Db;

    // Must resolve (not reject) — the internal try/catch logs + returns.
    await expect(
      migrateAnnouncementsToBilingual(failingDb, logger),
    ).resolves.toBeUndefined();
  });
});
