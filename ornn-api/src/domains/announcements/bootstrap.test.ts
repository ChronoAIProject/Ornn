/**
 * Announcements bootstrap wiring tests (#882).
 *
 * `wireAnnouncements` builds repo → ensureIndexes (fire-and-forget) →
 * one-shot bilingual backfill → service → routes, returning the service +
 * routes. Failures in the migration / index creation are non-fatal.
 *
 *   1. Happy path — `mongodb-memory-server`: resolves with a service +
 *      routes, and the bilingual backfill runs against the real Mongo.
 *   2. Fail-soft — an injected `Db` whose `createIndex` rejects (repo's
 *      inner guard) and whose `updateMany` resolves to a malformed result
 *      so the migration's post-`try` `matchedCount` read throws, exercising
 *      the bootstrap's migration `.catch`. The wiring still resolves.
 *
 * @module domains/announcements/bootstrap.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document } from "mongodb";
import pino from "pino";
import { wireAnnouncements } from "./bootstrap";

const logger = pino({ level: "silent" });

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("announcements_bootstrap_test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("announcements").deleteMany({});
});

describe("wireAnnouncements — happy path", () => {
  test("returns service + routes and runs the bilingual backfill", async () => {
    // Legacy single-locale doc — the backfill copies `title` into
    // `titleEn` / `titleZh`.
    await db.collection("announcements").insertOne({
      _id: "a-legacy" as unknown as Document["_id"],
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

    const { service, routes } = await wireAnnouncements({ db, logger });
    expect(service).toBeDefined();
    expect(typeof routes.request).toBe("function");

    const doc = await db
      .collection("announcements")
      .findOne({ _id: "a-legacy" as unknown as Document["_id"] });
    expect(doc?.titleEn).toBe("Legacy title");
    expect(doc?.titleZh).toBe("Legacy title");
    expect(doc?.bodyMarkdownEn).toBe("Legacy body");
    expect(doc?.ctaLabelEn).toBe("Legacy CTA");
  });
});

describe("wireAnnouncements — fail-soft", () => {
  test("injected failing db still resolves with service + routes", async () => {
    const failingDb = {
      collection: () => ({
        // Rejects → caught by the repo's own ensureIndexes try/catch.
        createIndex: () => Promise.reject(new Error("index boom")),
        // Resolves a malformed result so the migration's post-`try`
        // `result.matchedCount` read throws, hitting the bootstrap's
        // migration `.catch` (non-fatal).
        updateMany: () => Promise.resolve(undefined),
      }),
    } as unknown as Db;

    const { service, routes } = await wireAnnouncements({ db: failingDb, logger });
    expect(service).toBeDefined();
    expect(typeof routes.request).toBe("function");

    // Drain the fire-and-forget ensureIndexes().catch.
    await Promise.resolve();
  });
});
