/**
 * PlatformSettingsRepository unit tests (#454).
 *
 * Singleton document keyed by a fixed `_id`. Pins the partial-shape
 * contract — fields the admin hasn't touched MUST come back
 * undefined so the service layer can fall back to configmap
 * defaults.
 *
 * @module domains/platform/repository.test
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { PlatformSettingsRepository } from "./repository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: PlatformSettingsRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("platform_test");
  repo = new PlatformSettingsRepository(db);
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("platform_settings").deleteMany({});
});

describe("get", () => {
  test("empty collection returns empty object (not defaults)", async () => {
    const result = await repo.get();
    // Service layer applies defaults — repo MUST return undefined for
    // un-touched fields so the merge layer can tell "not set" from
    // "set to zero".
    expect(result).toEqual({});
  });

  test("returns only the fields the admin has set", async () => {
    await repo.patch({ auditWaiverThreshold: 5 });
    const result = await repo.get();
    expect(result.auditWaiverThreshold).toBe(5);
    expect(result.llmProvider).toBeUndefined();
  });

  test("normalizes llmProvider field shapes from raw doc", async () => {
    // Insert a doc with partial llmProvider directly to simulate an
    // old/corrupted record.
    await db.collection("platform_settings").insertOne({
      _id: "ornn" as never,
      llmProvider: { gatewayUrl: "https://x" },
    });
    const result = await repo.get();
    expect(result.llmProvider).toEqual({ gatewayUrl: "https://x", apiKey: "" });
  });

  test("ignores wrong-type fields", async () => {
    // Old data with wrong shape — repo MUST gracefully skip, not crash.
    await db.collection("platform_settings").insertOne({
      _id: "ornn" as never,
      auditWaiverThreshold: "not a number" as unknown as number,
    });
    const result = await repo.get();
    expect(result.auditWaiverThreshold).toBeUndefined();
  });
});

describe("patch", () => {
  test("upserts a fresh document on first patch", async () => {
    await repo.patch({ auditWaiverThreshold: 7 });
    const stored = await db.collection("platform_settings").findOne({ _id: "ornn" as never });
    expect(stored?.auditWaiverThreshold).toBe(7);
  });

  test("partial patches leave untouched fields alone", async () => {
    await repo.patch({
      auditWaiverThreshold: 5,
      llmProvider: { gatewayUrl: "https://x", apiKey: "enc" },
    });
    await repo.patch({ auditWaiverThreshold: 6 });
    const result = await repo.get();
    expect(result.auditWaiverThreshold).toBe(6);
    expect(result.llmProvider).toEqual({ gatewayUrl: "https://x", apiKey: "enc" });
  });

  test("empty patch is a no-op", async () => {
    const before = await db.collection("platform_settings").countDocuments();
    await repo.patch({});
    const after = await db.collection("platform_settings").countDocuments();
    expect(after).toBe(before); // No insert happened.
  });

  test("llmProvider with missing fields fills defaults", async () => {
    await repo.patch({
      llmProvider: { gatewayUrl: "https://x", apiKey: "" },
    });
    const result = await repo.get();
    expect(result.llmProvider).toEqual({ gatewayUrl: "https://x", apiKey: "" });
  });

  test("returns the post-patch state", async () => {
    const result = await repo.patch({ auditWaiverThreshold: 8 });
    expect(result.auditWaiverThreshold).toBe(8);
  });
});
