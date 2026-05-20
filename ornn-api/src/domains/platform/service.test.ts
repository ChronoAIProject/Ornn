/**
 * PlatformSettingsService unit tests (#454).
 *
 * Pins the cache contract + the at-rest encryption boundary (`apiKey`
 * is plaintext above the service, ciphertext below). Failures of the
 * crypto layer MUST degrade gracefully — an unreadable secret returns
 * empty string, not a throw, so the rest of the system keeps working.
 *
 * @module domains/platform/service.test
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
import { PlatformSettingsService } from "./service";

const ENCRYPTION_KEY = "test-encryption-key-32-chars-min-12345";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let service: PlatformSettingsService;
let repo: PlatformSettingsRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("platform_service_test");
  repo = new PlatformSettingsRepository(db);
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("platform_settings").deleteMany({});
  // Fresh service per test so the in-memory cache doesn't leak between cases.
  service = new PlatformSettingsService(repo, { encryptionKey: ENCRYPTION_KEY });
});

describe("get", () => {
  test("returns defaults when nothing has been set", async () => {
    const s = await service.get();
    expect(s.auditWaiverThreshold).toBeDefined();
    expect(s.llmProvider).toBeDefined();
    expect(s.llmProvider.apiKey).toBe(""); // No real key yet
  });

  test("returns admin-set values when present", async () => {
    await service.patch({ auditWaiverThreshold: 7 });
    const s = await service.get();
    expect(s.auditWaiverThreshold).toBe(7);
  });
});

describe("patch + encryption", () => {
  test("apiKey is stored as ciphertext, never plaintext", async () => {
    await service.patch({
      llmProvider: { gatewayUrl: "https://gw.test", apiKey: "secret-plaintext" },
    });
    const stored = await db.collection("platform_settings").findOne({ _id: "ornn" as never });
    // Cipher MUST NOT contain plaintext.
    expect(String(stored?.llmProvider?.apiKey ?? "")).not.toContain("secret-plaintext");
    expect((stored?.llmProvider?.apiKey ?? "").length).toBeGreaterThan(0);
  });

  test("get() round-trips apiKey plaintext through encryption", async () => {
    await service.patch({
      llmProvider: { gatewayUrl: "https://gw.test", apiKey: "round-trip-secret" },
    });
    const s = await service.get();
    expect(s.llmProvider.apiKey).toBe("round-trip-secret");
  });

  test("get() returns empty apiKey when decrypt fails (graceful degrade)", async () => {
    // Write a malformed v1 ciphertext (enc:1: prefix but garbage
    // payload) so decryptSecret throws. Plain-string values without
    // the prefix are passed through as legacy compat (separate path).
    await db.collection("platform_settings").updateOne(
      { _id: "ornn" as never },
      {
        $set: {
          llmProvider: {
            gatewayUrl: "https://gw.test",
            apiKey: "v1:notIV:notTag:notCipher",
          },
        },
        $setOnInsert: { _id: "ornn" },
      },
      { upsert: true },
    );
    // Fresh service (no cache); should NOT throw, just yield "".
    const fresh = new PlatformSettingsService(repo, { encryptionKey: ENCRYPTION_KEY });
    const s = await fresh.get();
    expect(s.llmProvider.apiKey).toBe("");
    expect(s.llmProvider.gatewayUrl).toBe("https://gw.test");
  });

  test("get() passes through pre-encryption legacy plaintext (no `enc:` prefix)", async () => {
    // Pre-encryption rows have raw plaintext in apiKey. decryptSecret
    // returns those unchanged so the migration to encrypted-at-rest
    // doesn't lock operators out of working configs.
    await db.collection("platform_settings").updateOne(
      { _id: "ornn" as never },
      {
        $set: {
          llmProvider: { gatewayUrl: "https://gw.test", apiKey: "legacy-plaintext" },
        },
        $setOnInsert: { _id: "ornn" },
      },
      { upsert: true },
    );
    const fresh = new PlatformSettingsService(repo, { encryptionKey: ENCRYPTION_KEY });
    expect((await fresh.get()).llmProvider.apiKey).toBe("legacy-plaintext");
  });
});

describe("cache", () => {
  test("repeat get() within TTL doesn't re-hit Mongo", async () => {
    await service.patch({ auditWaiverThreshold: 5 });
    const s1 = await service.get();
    // Tamper with the DB directly — service should NOT see the change
    // until cache expires.
    await db
      .collection("platform_settings")
      .updateOne({ _id: "ornn" as never }, { $set: { auditWaiverThreshold: 999 } });
    const s2 = await service.get();
    expect(s2.auditWaiverThreshold).toBe(s1.auditWaiverThreshold);
  });

  test("patch() busts the cache", async () => {
    await service.patch({ auditWaiverThreshold: 5 });
    expect((await service.get()).auditWaiverThreshold).toBe(5);
    await service.patch({ auditWaiverThreshold: 9 });
    expect((await service.get()).auditWaiverThreshold).toBe(9);
  });
});

describe("convenience accessors", () => {
  test("getAuditWaiverThreshold reads from the merged shape", async () => {
    await service.patch({ auditWaiverThreshold: 3 });
    expect(await service.getAuditWaiverThreshold()).toBe(3);
  });

  test("getLlmProviderConfig returns the decrypted plaintext shape", async () => {
    await service.patch({
      llmProvider: { gatewayUrl: "https://x.test", apiKey: "k" },
    });
    const cfg = await service.getLlmProviderConfig();
    expect(cfg.gatewayUrl).toBe("https://x.test");
    expect(cfg.apiKey).toBe("k");
  });
});
