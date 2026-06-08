/**
 * Broadcasts bootstrap wiring tests (#882).
 *
 * `wireBroadcastsRepo` runs `ensureIndexes` (fire-and-forget) + the
 * one-shot `recipientUserIds` backfill against a real Mongo, then returns
 * the shared repo. `wireBroadcasts` builds the service + routes on top.
 *
 *   1. Happy path — `mongodb-memory-server`: both functions resolve, the
 *      backfill runs, and pre-#502 docs are migrated to `null`.
 *   2. Fail-soft — an injected `Db` whose `updateMany` / `createIndex`
 *      reject: wiring still resolves (the migration + ensureIndexes
 *      swallow + log their own failures), nothing is thrown.
 *
 * @module domains/broadcasts/bootstrap.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document } from "mongodb";
import pino from "pino";
import { wireBroadcasts, wireBroadcastsRepo } from "./bootstrap";

const logger = pino({ level: "silent" });

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("broadcasts_bootstrap_test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("broadcasts").deleteMany({});
  await db.collection("broadcast_read_receipts").deleteMany({});
});

describe("wireBroadcastsRepo / wireBroadcasts — happy path", () => {
  test("returns a repo, runs the backfill, and builds service + routes", async () => {
    // Pre-#502 doc with no recipientUserIds field — the backfill should
    // set it to null on boot.
    await db.collection("broadcasts").insertOne({
      _id: "b-legacy" as unknown as Document["_id"],
      titleI18n: { en: "a", zh: "甲" },
      bodyMarkdownI18n: { en: "x", zh: "x" },
      createdBy: "u-admin",
      updatedBy: "u-admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { repo } = await wireBroadcastsRepo({ db, logger });
    expect(repo).toBeDefined();

    const doc = await db
      .collection("broadcasts")
      .findOne({ _id: "b-legacy" as unknown as Document["_id"] });
    expect("recipientUserIds" in (doc as Document)).toBe(true);
    expect(doc?.recipientUserIds).toBeNull();

    const { service, routes } = wireBroadcasts({ repo });
    expect(service).toBeDefined();
    // The routes object is a Hono app — it exposes a request dispatcher.
    expect(typeof routes.request).toBe("function");
  });
});

describe("wireBroadcastsRepo — fail-soft", () => {
  test("injected db whose updateMany rejects (inner backfill guard) still resolves", async () => {
    const boom = () => Promise.reject(new Error("mongo unavailable"));
    // Minimal Db stub: every collection rejects on the calls the repo
    // ensureIndexes + the backfill make. The backfill's own try/catch
    // logs + swallows the rejection, so the wiring promise must resolve.
    const failingDb = {
      collection: () => ({
        createIndex: boom,
        updateMany: boom,
      }),
    } as unknown as Db;

    const wiring = await wireBroadcastsRepo({ db: failingDb, logger });
    expect(wiring.repo).toBeDefined();

    // Drain the fire-and-forget ensureIndexes().catch so the rejected
    // promise is observed within the test (no unhandled rejection).
    await Promise.resolve();
  });

  test("backfill rejection that escapes its inner guard hits the bootstrap .catch", async () => {
    // `updateMany` resolves a malformed result so the backfill's post-`try`
    // `result.matchedCount` read throws OUTSIDE its internal try/catch — the
    // rejection then propagates to `backfill(...).catch(...)` in bootstrap.ts
    // (the non-fatal error-log arm). Wiring must still resolve.
    const failingDb = {
      collection: () => ({
        createIndex: () => Promise.resolve("idx"),
        updateMany: () => Promise.resolve(undefined),
      }),
    } as unknown as Db;

    const wiring = await wireBroadcastsRepo({ db: failingDb, logger });
    expect(wiring.repo).toBeDefined();
    await Promise.resolve();
  });
});
