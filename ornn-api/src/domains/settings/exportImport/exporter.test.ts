/**
 * UT-EXPORT-001..007 — exporter unit tests.
 *
 * @module domains/settings/exportImport/exporter.test
 */

import { describe, expect, it } from "bun:test";
import { isRedactionSentinel } from "../../../infra/crypto";
import { SettingsExporter } from "./exporter";
import { mirrorSection, nyxidSection, sections } from "../sections";
import type { SettingsService } from "../types";
import type { LlmProvider } from "../llmProviders/types";

function fakeSettingsService(): SettingsService {
  const store = new Map<string, Record<string, unknown>>();
  store.set("playground", {
    defaultProviderId: "openai",
    defaultModelId: "gpt-4o",
    sseKeepAliveMs: 15_000,
  });
  store.set("skillGen", {
    defaultProviderId: null,
    defaultModelId: null,
    sseKeepAliveMs: 15_000,
  });
  store.set("mirror", {
    ...mirrorSection.defaults,
    enabled: true,
    owner: "ChronoAIProject",
    repo: "ornn-skills",
    branch: "main",
    appId: "12345",
    installationId: "67890",
    appPrivateKey: "real-pem-content",
  });
  store.set("nyxid", {
    ...nyxidSection.defaults,
    tokenUrl: "https://nyx.example.com/oauth/token",
    clientId: "ornn-api",
    clientSecret: "real-client-secret",
    chronoStorageBucket: "ornn",
  });
  store.set("skillAudit", { ...sections.skillAudit.defaults });
  store.set("telemetry", { ...sections.telemetry.defaults, postHogApiKey: "phc-xyz" });
  store.set("extras", { extraNyxidServices: [] });

  const providers: LlmProvider[] = [
    {
      _id: "p1",
      name: "openai",
      gatewayUrl: "https://api.openai.com",
      modelListUrl: "https://api.openai.com/v1/models",
      apiFormat: "chat-completion",
      auth: { kind: "apiKey", apiKey: "sk-real" },
      models: [],
      maxOutputTokens: 8192,
      defaultTemperature: 0.7,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      updatedBy: "system",
    },
  ];

  const make = async <T,>(id: string): Promise<T> =>
    store.get(id) as T;

  return {
    getPlayground: () => make("playground"),
    getSkillGen: () => make("skillGen"),
    getMirror: () => make("mirror"),
    getNyxid: () => make("nyxid"),
    getSkillAudit: () => make("skillAudit"),
    getTelemetry: () => make("telemetry"),
    getExtras: () => make("extras"),
    getSection: <T,>(id: string) => make<T>(id),
    putSection: async () => ({ value: {} as never, changedFields: [] }),
    listLlmProviders: async () => providers,
    getLlmProvider: async (id: string) => providers.find((p) => p._id === id) ?? null,
    invalidateCache: () => {},
  };
}

describe("SettingsExporter", () => {
  it("UT-EXPORT-001: envelope contains all 7 sections + schemaVersion + exportedAt", async () => {
    const fixed = new Date("2026-05-06T12:00:00.000Z");
    const exporter = new SettingsExporter({
      settingsService: fakeSettingsService(),
      ornnVersion: "1.2.3",
      clock: () => fixed,
    });
    const env = await exporter.export();
    expect(env.schemaVersion).toBe(1);
    expect(env.exportedAt).toBe("2026-05-06T12:00:00.000Z");
    expect(env.ornnVersion).toBe("1.2.3");
    const sectionIds = Object.keys(env.sections);
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
      expect(sectionIds).toContain(id);
    }
  });

  it("UT-EXPORT-002/003: secrets are replaced with `<REDACTED:fieldName>`", async () => {
    const exporter = new SettingsExporter({ settingsService: fakeSettingsService() });
    const env = await exporter.export();
    const mirror = env.sections.mirror as Record<string, unknown>;
    expect(isRedactionSentinel(mirror.appPrivateKey)).toBe(true);
    const nyxid = env.sections.nyxid as Record<string, unknown>;
    expect(isRedactionSentinel(nyxid.clientSecret)).toBe(true);
    const telemetry = env.sections.telemetry as Record<string, unknown>;
    expect(isRedactionSentinel(telemetry.postHogApiKey)).toBe(true);
    const providers = env.sections.llmProviders as Array<Record<string, unknown>>;
    const auth = providers[0].auth as Record<string, unknown>;
    expect(isRedactionSentinel(auth.apiKey)).toBe(true);
  });

  it("UT-EXPORT-004: non-secret fields byte-equal", async () => {
    const exporter = new SettingsExporter({ settingsService: fakeSettingsService() });
    const env = await exporter.export();
    const mirror = env.sections.mirror as Record<string, unknown>;
    expect(mirror.owner).toBe("ChronoAIProject");
    expect(mirror.repo).toBe("ornn-skills");
    expect(mirror.appId).toBe("12345");
    expect(mirror.enabled).toBe(true);
    const playground = env.sections.playground as Record<string, unknown>;
    expect(playground.defaultProviderId).toBe("openai");
  });

  it("UT-EXPORT-006: exportedAt is ISO-8601 UTC", async () => {
    const fixed = new Date("2026-05-06T12:34:56.789Z");
    const exporter = new SettingsExporter({
      settingsService: fakeSettingsService(),
      clock: () => fixed,
    });
    const env = await exporter.export();
    expect(env.exportedAt).toBe(fixed.toISOString());
  });

  it("UT-EXPORT-007: filename matches `ornn-settings-<env>-<iso>.json`", async () => {
    const fixed = new Date("2026-05-06T12:34:56.789Z");
    const exporter = new SettingsExporter({
      settingsService: fakeSettingsService(),
      clock: () => fixed,
    });
    const fname = exporter.filenameFor("staging");
    expect(fname).toMatch(/^ornn-settings-staging-2026-05-06T12-34-56-789Z\.json$/);
  });
});
