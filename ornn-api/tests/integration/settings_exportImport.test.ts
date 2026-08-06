/**
 * IT-SETTINGS-EXPORT-IMPORT-ROUNDTRIP, IT-SETTINGS-EXPORT-INCLUDES-ALL-SECTIONS,
 * IT-SETTINGS-IMPORT-PARTIAL-FAIL, IT-SETTINGS-IMPORT-SCHEMA-MISMATCH.
 *
 * Drives the export/import pipeline against a real `mongodb-memory-server`
 * Mongo + the actual SettingsServiceImpl (not a fake) so sentinel
 * resolution and crypto flow end-to-end.
 *
 * @module tests/integration/settings_exportImport.test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { isRedactionSentinel, redactSentinel } from "../../src/infra/crypto";
import { SettingsRepository } from "../../src/domains/settings/repository";
import { SettingsServiceImpl } from "../../src/domains/settings/service";
import {
  SettingsExporter,
  SETTINGS_SCHEMA_VERSION,
} from "../../src/domains/settings/exportImport/exporter";
import { SettingsImporter } from "../../src/domains/settings/exportImport/importer";

const KEY = "ornn-test-passphrase-32-chars-min-okOK";
const ACTOR = { userId: "u-admin", email: "admin@test.local", displayName: "Admin" };

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let svc: SettingsServiceImpl;
let exporter: SettingsExporter;
let importer: SettingsImporter;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("ornn-it-settings");
  const repo = new SettingsRepository(db);
  svc = new SettingsServiceImpl({
    repo,
    encryptionKey: KEY,
    cacheTtlMs: 100,
  });
  exporter = new SettingsExporter({ settingsService: svc, ornnVersion: "test" });
  importer = new SettingsImporter({ settingsService: svc });
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
}, 30_000);

describe("IT-SETTINGS export/import", () => {
  it("IT-SETTINGS-EXPORT-INCLUDES-ALL-SECTIONS: every defined section is in the envelope", async () => {
    const env = await exporter.export();
    const ids = Object.keys(env.sections);
    for (const id of [
      "playground",
      "skillGen",
      "mirror",
      "nyxid",
      "skillAudit",
      "telemetry",
      "extras",
      "llmProviders",
    ]) {
      expect(ids).toContain(id);
    }
    expect(env.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it("IT-SETTINGS-EXPORT-IMPORT-ROUNDTRIP: round-trip preserves non-secret + secret-via-sentinel fields", async () => {
    // Seed: write a mirror section with a real secret + a quota defaults change.
    await svc.putSection(
      "mirror",
      {
        enabled: true,
        owner: "ChronoAIProject",
        repo: "ornn-skills",
        branch: "main",
        appId: "12345",
        installationId: "67890",
        appPrivateKey: "real-pem-content",
        reconcileSchedule: "0 2 * * *",
      },
      ACTOR,
    );
    await svc.putSection(
      "playground",
      {
        defaultProviderId: null,
        defaultModelId: null,
        sseKeepAliveMs: 15_000,
        defaultMonthlyQuota: 500,
      },
      ACTOR,
    );

    // Export. Secrets should be redacted.
    const env = await exporter.export();
    const mirror = env.sections.mirror as Record<string, unknown>;
    expect(isRedactionSentinel(mirror.appPrivateKey)).toBe(true);
    expect(mirror.owner).toBe("ChronoAIProject");
    expect(mirror.appId).toBe("12345");

    // Now mutate state — change owner, then import the original envelope.
    await svc.putSection(
      "mirror",
      {
        enabled: false,
        owner: "MutatedOwner",
        repo: "other-repo",
        branch: "dev",
        appId: "99999",
        installationId: "00000",
        appPrivateKey: redactSentinel("appPrivateKey"), // keep DB
        reconcileSchedule: "0 2 * * *",
      },
      ACTOR,
    );

    // Re-import the original envelope: non-secrets restore, secret is preserved (via sentinel).
    const result = await importer.import(env, ACTOR);
    expect(result.aggregateStatus).toBe("applied");

    const after = await svc.getMirror();
    expect(after.owner).toBe("ChronoAIProject"); // restored from envelope
    expect(after.appId).toBe("12345");
    expect(after.appPrivateKey).toBe("real-pem-content"); // preserved via sentinel
  });

  it("IT-SETTINGS-IMPORT-PARTIAL-FAIL: invalid section reports failed; valid section applies", async () => {
    const result = await importer.import(
      {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        sections: {
          playground: {
            defaultProviderId: "p",
            defaultModelId: "m",
            sseKeepAliveMs: 100, // invalid
            defaultMonthlyQuota: 200,
          },
          skillGen: {
            defaultProviderId: null,
            defaultModelId: null,
            sseKeepAliveMs: 15_000,
            defaultMonthlyQuota: 75,
          },
        },
      },
      ACTOR,
    );
    expect(result.aggregateStatus).toBe("partial");
    const playground = result.sections.find((s) => s.id === "playground")!;
    const skillGen = result.sections.find((s) => s.id === "skillGen")!;
    expect(playground.status).toBe("failed");
    expect(skillGen.status).toBe("applied");

    // Confirm DB state: skillGen was written, playground was not.
    const sg = await svc.getSkillGen();
    expect(sg.defaultMonthlyQuota).toBe(75);
  });

  it("IT-SETTINGS-IMPORT-SCHEMA-MISMATCH: bad schemaVersion → no writes", async () => {
    // Snapshot the current skillGen — it must remain unchanged after a schema-mismatch import.
    const before = await svc.getSkillGen();
    const result = await importer.import(
      {
        schemaVersion: 0,
        sections: {
          skillGen: {
            defaultProviderId: null,
            defaultModelId: null,
            sseKeepAliveMs: 15_000,
            defaultMonthlyQuota: 1,
          },
        },
      },
      ACTOR,
    );
    expect(result.aggregateStatus).toBe("failed");
    const after = await svc.getSkillGen();
    expect(after).toEqual(before);
  });
});
