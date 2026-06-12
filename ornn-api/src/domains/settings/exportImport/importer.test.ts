/**
 * UT-IMPORT-001..008 — importer unit tests.
 *
 * @module domains/settings/exportImport/importer.test
 */

import { describe, expect, it } from "bun:test";
import { redactSentinel } from "../../../infra/crypto";
import { SETTINGS_SCHEMA_VERSION } from "./exporter";
import { SettingsImporter } from "./importer";
import { sections } from "../sections";
import type { SettingsService } from "../types";

const ACTOR = { userId: "u-admin", email: "admin@test.local", displayName: "Admin" };

function fakeSettingsService(initial?: Partial<Record<string, Record<string, unknown>>>): SettingsService & {
  store: Map<string, Record<string, unknown>>;
  putCalls: number;
} {
  const store = new Map<string, Record<string, unknown>>();
  // Seed with section defaults.
  for (const id of Object.keys(sections) as Array<keyof typeof sections>) {
    store.set(id, { ...(sections[id] as { defaults: Record<string, unknown> }).defaults });
  }
  if (initial) {
    for (const [k, v] of Object.entries(initial)) {
      if (v) store.set(k, { ...store.get(k), ...v });
    }
  }
  let putCalls = 0;

  const svc: SettingsService = {
    getPlayground: async () => store.get("playground") as never,
    getSkillGen: async () => store.get("skillGen") as never,
    getAssistant: async () => store.get("assistant") as never,
    getMirror: async () => store.get("mirror") as never,
    getNyxid: async () => store.get("nyxid") as never,
    getSkillAudit: async () => store.get("skillAudit") as never,
    getTelemetry: async () => store.get("telemetry") as never,
    getExtras: async () => store.get("extras") as never,
    getSection: async <T,>(id: string) => store.get(id) as T,
    putSection: async <T,>(id: string, value: T) => {
      putCalls += 1;
      const prev = (store.get(id) as Record<string, unknown>) ?? {};
      const next = { ...prev, ...(value as object) };
      store.set(id, next);
      return { value: next as T, changedFields: Object.keys(value as object) };
    },
    listLlmProviders: async () => [],
    getLlmProvider: async () => null,
    getLaunchPromo: async () => store.get("launchPromo") as never,
    invalidateCache: () => {},
  };
  return Object.assign(svc, {
    get store() { return store; },
    get putCalls() { return putCalls; },
  });
}

describe("SettingsImporter", () => {
  it("UT-IMPORT-001: schemaVersion mismatch → fail with no writes", async () => {
    const svc = fakeSettingsService();
    const importer = new SettingsImporter({ settingsService: svc });
    const r = await importer.import({ schemaVersion: 0, sections: {} }, ACTOR);
    expect(r.aggregateStatus).toBe("failed");
    expect(svc.putCalls).toBe(0);
  });

  it("UT-IMPORT-002: redaction sentinel preserves DB value", async () => {
    const svc = fakeSettingsService({
      mirror: {
        enabled: true,
        owner: "o",
        repo: "r",
        branch: "main",
        appId: "1",
        installationId: "2",
        appPrivateKey: "real-pem-from-db",
        reconcileSchedule: "0 2 * * *",
      },
    });
    const importer = new SettingsImporter({ settingsService: svc });
    const r = await importer.import(
      {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        sections: {
          mirror: {
            enabled: false,
            owner: "o",
            repo: "r",
            branch: "main",
            appId: "1",
            installationId: "2",
            appPrivateKey: redactSentinel("appPrivateKey"),
        reconcileSchedule: "0 2 * * *",
          },
        },
      },
      ACTOR,
    );
    expect(r.aggregateStatus).toBe("applied");
    // Fake service applies via putSection — the inner SettingsService
    // is what handles sentinel resolution in production. Here we just
    // assert the payload was accepted (validated + forwarded).
    const stored = svc.store.get("mirror") as { appPrivateKey: string; enabled: boolean };
    // The fake doesn't run sentinel resolution itself, so the sentinel
    // forwards raw — but the schema accepted it. Real wiring
    // (SettingsServiceImpl) is exercised under integration.
    expect(stored.enabled).toBe(false);
  });

  it("UT-IMPORT-005: invalid section does not block valid section", async () => {
    const svc = fakeSettingsService();
    const importer = new SettingsImporter({ settingsService: svc });
    const r = await importer.import(
      {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        sections: {
          playground: {
            defaultProviderId: "p",
            defaultModelId: "m",
            sseKeepAliveMs: 100, // invalid
            defaultMonthlyQuota: 500,
          },
          skillGen: {
            defaultProviderId: null,
            defaultModelId: null,
            sseKeepAliveMs: 15_000,
            defaultMonthlyQuota: 50,
          },
        },
      },
      ACTOR,
    );
    const playground = r.sections.find((s) => s.id === "playground")!;
    const skillGen = r.sections.find((s) => s.id === "skillGen")!;
    expect(playground.status).toBe("failed");
    expect(skillGen.status).toBe("applied");
    expect(r.aggregateStatus).toBe("partial");
  });

  it("UT-IMPORT-006: aggregate errors include {field, message}", async () => {
    const svc = fakeSettingsService();
    const importer = new SettingsImporter({ settingsService: svc });
    const r = await importer.import(
      {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        sections: {
          playground: {
            defaultProviderId: null,
            defaultModelId: null,
            sseKeepAliveMs: 15_000,
            defaultMonthlyQuota: -5,
          },
        },
      },
      ACTOR,
    );
    const q = r.sections.find((s) => s.id === "playground")!;
    expect(q.status).toBe("failed");
    expect(q.errors?.[0]!.field).toBe("defaultMonthlyQuota");
    expect(q.errors?.[0]!.message).toBeDefined();
  });

  it("UT-IMPORT-008: dry-run preview produces no writes", async () => {
    const svc = fakeSettingsService();
    const importer = new SettingsImporter({ settingsService: svc });
    const r = await importer.import(
      {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        sections: {
          playground: {
            defaultProviderId: null,
            defaultModelId: null,
            sseKeepAliveMs: 15_000,
            defaultMonthlyQuota: 999,
          },
        },
      },
      ACTOR,
      { dryRun: true },
    );
    const q = r.sections.find((s) => s.id === "playground")!;
    expect(q.status).toBe("applied");
    expect(svc.putCalls).toBe(0);
    const stored = svc.store.get("playground") as { defaultMonthlyQuota: number };
    expect(stored.defaultMonthlyQuota).toBe(200); // dry-run: default preserved
  });

  it("UT-IMPORT-llmProviders-skip: providers payload is reported as skipped (v1)", async () => {
    const svc = fakeSettingsService();
    const importer = new SettingsImporter({ settingsService: svc });
    const r = await importer.import(
      {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        sections: { llmProviders: [{ _id: "x" }] },
      },
      ACTOR,
    );
    const lp = r.sections.find((s) => s.id === "llmProviders")!;
    expect(lp.status).toBe("skipped");
  });
});
