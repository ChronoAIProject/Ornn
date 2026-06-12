/**
 * Tests for `wireNotifications` (#580 bootstrap decomposition).
 *
 * Two arms:
 *
 *   1. Happy path over a real `mongodb-memory-server` Mongo: wiring
 *      returns `{ service, routes }`, and the one-time #218 legacy-row
 *      migration actually runs — a `share.*` row seeded BEFORE wiring is
 *      gone AFTER, while a current-vocabulary row survives.
 *
 *   2. Fail-soft arm: a fake `Db` whose `createIndex` (ensureIndexes) AND
 *      `countDocuments` (dropLegacyNotificationCategories) reject.
 *      `wireNotifications` must STILL resolve — both `.catch` arms in
 *      bootstrap.ts swallow the failure so a flaky index/migration never
 *      blocks the boot — and still return a usable `{ service, routes }`.
 *
 * @module domains/notifications/bootstrap.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document } from "mongodb";
import pino from "pino";
import { BroadcastRepository } from "../broadcasts/repository";
import type { BroadcastRepository as BroadcastRepositoryType } from "../broadcasts/repository";
import { NotificationService } from "./service";
import { wireNotifications } from "./bootstrap";

const logger = pino({ level: "silent" });

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let broadcastRepo: BroadcastRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("notifications_bootstrap_test");
  broadcastRepo = new BroadcastRepository(db);
  await broadcastRepo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("notifications").deleteMany({});
});

describe("wireNotifications — happy path", () => {
  test("returns a service + routes and runs the #218 cleanup migration", async () => {
    // Seed one legacy row + one current row BEFORE wiring.
    await db.collection("notifications").insertMany([
      {
        _id: "legacy-1" as unknown as Document["_id"],
        userId: "u-1",
        category: "share.needs_justification",
        title: "legacy",
        data: {},
        readAt: null,
        createdAt: new Date(),
      },
      {
        _id: "keep-1" as unknown as Document["_id"],
        userId: "u-1",
        category: "audit.completed",
        title: "current",
        data: {},
        readAt: null,
        createdAt: new Date(),
      },
    ]);

    const wiring = await wireNotifications({ db, logger, broadcastRepo });

    expect(wiring.service).toBeInstanceOf(NotificationService);
    // Routes is a Hono app — it exposes a `request` dispatcher.
    expect(typeof wiring.routes.request).toBe("function");

    // The migration ran during wiring: legacy row gone, current row kept.
    const remaining = await db.collection("notifications").find({}).toArray();
    expect(remaining.map((d) => String(d._id))).toEqual(["keep-1"]);
  });
});

describe("wireNotifications — fail-soft arm", () => {
  test("resolves even when ensureIndexes AND the migration both reject", async () => {
    // A minimal fake Db: every collection call routes through a single
    // collection stub whose index + count operations reject. This drives
    // BOTH bootstrap catch arms (ensureIndexes .catch, migration .catch).
    const failingCollection = {
      createIndex: async () => {
        throw new Error("index build failed");
      },
      countDocuments: async () => {
        throw new Error("count failed");
      },
    };
    const fakeDb = {
      collection: () => failingCollection,
    } as unknown as Db;

    // A no-op broadcasts repo — fail-soft arm only exercises the
    // notification side; broadcasts wiring is covered elsewhere.
    const fakeBroadcastRepo = {} as unknown as BroadcastRepositoryType;

    // Must resolve despite both rejections being swallowed by .catch.
    const wiring = await wireNotifications({
      db: fakeDb,
      logger,
      broadcastRepo: fakeBroadcastRepo,
    });
    expect(wiring.service).toBeInstanceOf(NotificationService);
    expect(typeof wiring.routes.request).toBe("function");
  });
});
