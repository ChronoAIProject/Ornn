/**
 * Route-level tests for settings export/import — body-limit gate +
 * audit-log emission + plaintext-secret guard.
 *
 * Drives the Hono app in-process via `app.request()` so no port binds.
 *
 * @module domains/settings/exportImport/routes.test
 */

import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import { SettingsExporter, SETTINGS_SCHEMA_VERSION } from "./exporter";
import { SettingsImporter } from "./importer";
import {
  createSettingsExportImportRoutes,
  type SettingsAuditLogger,
} from "./routes";
import { sections } from "../sections";
import type { SettingsService } from "../types";

function fakeSettingsService(): SettingsService {
  const store = new Map<string, Record<string, unknown>>();
  for (const id of Object.keys(sections) as Array<keyof typeof sections>) {
    store.set(id, { ...(sections[id] as { defaults: Record<string, unknown> }).defaults });
  }
  return {
    getPlayground: async () => store.get("playground") as never,
    getSkillGen: async () => store.get("skillGen") as never,
    getMirror: async () => store.get("mirror") as never,
    getNyxid: async () => store.get("nyxid") as never,
    getSkillAudit: async () => store.get("skillAudit") as never,
    getTelemetry: async () => store.get("telemetry") as never,
    getExtras: async () => store.get("extras") as never,
    getSection: async <T,>(id: string) => store.get(id) as T,
    putSection: async <T,>(id: string, value: T) => {
      const prev = (store.get(id) as Record<string, unknown>) ?? {};
      const next = { ...prev, ...(value as object) };
      store.set(id, next);
      return { value: next as T, changedFields: Object.keys(value as object) };
    },
    listLlmProviders: async () => [],
    getLlmProvider: async () => null,
    invalidateCache: () => {},
  };
}

function makeApp(opts: {
  audit?: SettingsAuditLogger;
  importMaxBytes?: number;
} = {}): { app: Hono } {
  const svc = fakeSettingsService();
  const exporter = new SettingsExporter({
    settingsService: svc,
    ornnVersion: "test",
  });
  const importer = new SettingsImporter({ settingsService: svc });
  const routes = createSettingsExportImportRoutes({
    exporter,
    importer,
    auditLogger: opts.audit,
    importMaxBytes: opts.importMaxBytes,
  });
  const app = new Hono();
  // The route's `nyxidAuthMiddleware` reads `c.var.auth`; in production
  // it's set upstream by `proxyAuthSetup`. Stub the same shape directly
  // so the route-level tests don't need to drag in the full proxy
  // header pipeline.
  app.use("*", async (c, next) => {
    c.set("auth" as never, {
      userId: "u-admin",
      email: "admin@test.local",
      displayName: "Admin",
      permissions: ["ornn:admin:skill"],
    } as never);
    await next();
  });
  app.route("/api/v1", routes);
  // AppError is a domain error; the test app needs a tiny error handler so
  // 4xx surfaces with the expected status (otherwise Hono returns 500).
  app.onError((err, c) => {
    const code = (err as { code?: string }).code ?? "internal_error";
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return c.json(
      { data: null, error: { code, message: err.message } },
      status as never,
    );
  });
  return { app };
}

describe("settings export/import routes", () => {
  it("S4: import body over the limit is rejected with 413", async () => {
    const { app } = makeApp({ importMaxBytes: 256 });
    const oversize = "x".repeat(2_000);
    const body = JSON.stringify({ schemaVersion: 1, garbage: oversize });
    // Explicit Content-Length so hono's body-limit short-circuits on the
    // header check rather than the streaming-count path (which requires
    // a real Reader and is brittle in `app.request()` synthetic flows).
    const res = await app.request("/api/v1/admin/settings/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(body.length),
      },
      body,
    });
    expect(res.status).toBe(413);
  });

  it("S4: import body under the limit is accepted", async () => {
    const { app } = makeApp({ importMaxBytes: 1_000_000 });
    const res = await app.request("/api/v1/admin/settings/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        sections: {
          playground: {
            defaultProviderId: null,
            defaultModelId: null,
            sseKeepAliveMs: 15_000,
            defaultMonthlyQuota: 300,
          },
        },
      }),
    });
    expect(res.status).toBe(200);
  });

  it("G3: audit logger fires on export with schemaVersion + actor", async () => {
    const recordExport = mock(async () => {});
    const recordImport = mock(async () => {});
    const audit: SettingsAuditLogger = { recordExport, recordImport };
    const { app } = makeApp({ audit });
    const res = await app.request("/api/v1/admin/settings/export", {
      method: "GET",
      headers: {},
    });
    expect(res.status).toBe(200);
    // Drain the body so the response handler completes.
    await res.text();
    // The audit emission is fire-and-forget; give the microtask queue a tick.
    await new Promise((r) => setTimeout(r, 5));
    expect(recordExport).toHaveBeenCalledTimes(1);
    const calls = recordExport.mock.calls as unknown as Array<
      [{ actor: { userId: string }; schemaVersion: number }]
    >;
    const args = calls[0]![0];
    expect(args.actor.userId).toBe("u-admin");
    expect(args.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(recordImport).not.toHaveBeenCalled();
  });

  it("G3: audit logger fires on import with per-section status", async () => {
    const recordImport = mock(async () => {});
    const audit: SettingsAuditLogger = {
      recordExport: async () => {},
      recordImport,
    };
    const { app } = makeApp({ audit });
    const res = await app.request("/api/v1/admin/settings/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        sections: {
          playground: {
            defaultProviderId: null,
            defaultModelId: null,
            sseKeepAliveMs: 15_000,
            defaultMonthlyQuota: 400,
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(recordImport).toHaveBeenCalledTimes(1);
    const calls = recordImport.mock.calls as unknown as Array<
      [
        {
          schemaVersion: number;
          aggregateStatus: string;
          sections: Array<{ id: string; status: string }>;
          dryRun: boolean;
        },
      ]
    >;
    const args = calls[0]![0];
    expect(args.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(args.aggregateStatus).toBe("applied");
    expect(args.dryRun).toBe(false);
    const playground = args.sections.find((s) => s.id === "playground")!;
    expect(playground.status).toBe("applied");
  });

  it("G3: dryRun=true in BODY is honored — response audit reports dryRun=true (#330)", async () => {
    const recordImport = mock(async () => {});
    const audit: SettingsAuditLogger = {
      recordExport: async () => {},
      recordImport,
    };
    const { app } = makeApp({ audit });
    const res = await app.request("/api/v1/admin/settings/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        sections: {
          playground: {
            defaultProviderId: null,
            defaultModelId: null,
            sseKeepAliveMs: 15_000,
            defaultMonthlyQuota: 99,
          },
        },
        dryRun: true,
      }),
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    const args = (recordImport.mock.calls as unknown as Array<
      [{ dryRun: boolean }]
    >)[0]![0];
    expect(args.dryRun).toBe(true);
  });

  it("G3: GET /export returns standard { data, error } envelope (#330)", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/v1/admin/settings/export", {
      method: "GET",
      headers: {},
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data?: { schemaVersion: number };
      error: unknown;
    };
    expect(json.error).toBeNull();
    expect(json.data).toBeDefined();
    expect(json.data!.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it("G3: audit emission failure does not break the response", async () => {
    const recordExport = mock(async () => {
      throw new Error("audit-broken");
    });
    const audit: SettingsAuditLogger = {
      recordExport,
      recordImport: async () => {},
    };
    const { app } = makeApp({ audit });
    const res = await app.request("/api/v1/admin/settings/export", {
      method: "GET",
      headers: {},
    });
    expect(res.status).toBe(200);
    await res.text();
    await new Promise((r) => setTimeout(r, 5));
    expect(recordExport).toHaveBeenCalled();
  });
});
