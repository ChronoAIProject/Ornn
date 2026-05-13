/**
 * Tests for the legacy mirror config -> per-section migration.
 *
 * Uses `mongodb-memory-server` (already a test dep) so the actual
 * Mongo update behaviour is exercised end-to-end rather than relying
 * on a hand-rolled in-memory fake.
 *
 * @module domains/settings/sections/mirror.migration.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db, type Document } from "mongodb";
import pino from "pino";
import { migrateLegacyMirrorIntoSettings } from "./mirror.migration";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
const logger = pino({ level: "silent" });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("mirror_migration_test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("platform_settings").deleteMany({});
});

describe("migrateLegacyMirrorIntoSettings", () => {
  test("copies legacy githubMirror -> settings.mirror when new doc absent", async () => {
    await db.collection("platform_settings").insertOne({
      _id: "ornn" as unknown as Document["_id"],
      githubMirror: {
        enabled: true,
        owner: "ChronoAIProject",
        repo: "ornn-skills",
        branch: "main",
        appId: "12345",
        installationId: "67890",
        appPrivateKey: "ciphertext-abc",
      },
      auditWaiverThreshold: 6,
    });

    await migrateLegacyMirrorIntoSettings(db, logger);

    const newDoc = await db
      .collection("platform_settings")
      .findOne({ _id: "mirror" as unknown as Document["_id"] });
    expect(newDoc).not.toBeNull();
    expect((newDoc as unknown as { value: Record<string, unknown> }).value).toEqual({
      enabled: true,
      owner: "ChronoAIProject",
      repo: "ornn-skills",
      branch: "main",
      appId: "12345",
      installationId: "67890",
      // ciphertext copied byte-for-byte — not re-encrypted
      appPrivateKey: "ciphertext-abc",
    });
    expect((newDoc as unknown as { updatedBy: string }).updatedBy).toBe(
      "system:legacy-mirror-migration",
    );
  });

  test("no-op when new mirror doc already exists (idempotent)", async () => {
    // pre-seed both legacy and new docs; the new one is "authoritative"
    await db.collection("platform_settings").insertOne({
      _id: "ornn" as unknown as Document["_id"],
      githubMirror: {
        enabled: true,
        owner: "legacy-owner",
        repo: "legacy-repo",
        branch: "main",
        appId: "1",
        installationId: "2",
        appPrivateKey: "legacy-ct",
      },
    });
    await db.collection("platform_settings").insertOne({
      _id: "mirror" as unknown as Document["_id"],
      value: {
        enabled: false,
        owner: "new-owner",
        repo: "new-repo",
        branch: "develop",
        appId: "",
        installationId: "",
        appPrivateKey: "",
      },
      updatedAt: new Date(),
      updatedBy: "admin@example",
    });

    await migrateLegacyMirrorIntoSettings(db, logger);

    const newDoc = await db
      .collection("platform_settings")
      .findOne({ _id: "mirror" as unknown as Document["_id"] });
    expect((newDoc as unknown as { value: Record<string, unknown> }).value.owner).toBe(
      "new-owner",
    );
    expect((newDoc as unknown as { updatedBy: string }).updatedBy).toBe("admin@example");
  });

  test("no-op when legacy doc absent entirely", async () => {
    await migrateLegacyMirrorIntoSettings(db, logger);
    const newDoc = await db
      .collection("platform_settings")
      .findOne({ _id: "mirror" as unknown as Document["_id"] });
    expect(newDoc).toBeNull();
  });

  test("no-op when legacy doc exists but has no githubMirror field", async () => {
    await db.collection("platform_settings").insertOne({
      _id: "ornn" as unknown as Document["_id"],
      auditWaiverThreshold: 6,
    });
    await migrateLegacyMirrorIntoSettings(db, logger);
    const newDoc = await db
      .collection("platform_settings")
      .findOne({ _id: "mirror" as unknown as Document["_id"] });
    expect(newDoc).toBeNull();
  });

  test("defaults missing/wrong-typed fields to empty/false", async () => {
    await db.collection("platform_settings").insertOne({
      _id: "ornn" as unknown as Document["_id"],
      githubMirror: {
        // intentionally partial / malformed: enabled wrong type, branch missing
        enabled: "yes" as unknown as boolean,
        owner: "x",
        repo: "y",
      },
    });
    await migrateLegacyMirrorIntoSettings(db, logger);
    const newDoc = await db
      .collection("platform_settings")
      .findOne({ _id: "mirror" as unknown as Document["_id"] });
    const value = (newDoc as unknown as { value: Record<string, unknown> }).value;
    expect(value).toEqual({
      enabled: false,
      owner: "x",
      repo: "y",
      branch: "",
      appId: "",
      installationId: "",
      appPrivateKey: "",
    });
  });

  test("running twice is a no-op after first success (full idempotency)", async () => {
    await db.collection("platform_settings").insertOne({
      _id: "ornn" as unknown as Document["_id"],
      githubMirror: {
        enabled: true,
        owner: "o",
        repo: "r",
        branch: "main",
        appId: "1",
        installationId: "2",
        appPrivateKey: "ct",
      },
    });

    await migrateLegacyMirrorIntoSettings(db, logger);
    const after1 = await db
      .collection("platform_settings")
      .findOne({ _id: "mirror" as unknown as Document["_id"] });
    const ts1 = (after1 as unknown as { updatedAt: Date }).updatedAt.getTime();

    // tiny delay so any new updatedAt would be visibly different
    await new Promise((r) => setTimeout(r, 5));

    await migrateLegacyMirrorIntoSettings(db, logger);
    const after2 = await db
      .collection("platform_settings")
      .findOne({ _id: "mirror" as unknown as Document["_id"] });
    const ts2 = (after2 as unknown as { updatedAt: Date }).updatedAt.getTime();

    // second run must NOT touch the doc — updatedAt unchanged
    expect(ts2).toBe(ts1);
  });
});
