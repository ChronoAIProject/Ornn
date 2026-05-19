/**
 * Settings export/import routes.
 *   GET  /admin/settings/export   → JSON envelope, attachment header
 *   POST /admin/settings/import   → parse + apply, returns per-section status
 *
 * Both endpoints emit a settings-audit event via the injected
 * `SettingsAuditLogger` (Story 8.1 + 8.2 acceptance criterion).
 * Bootstrap wires this to `analyticsEmitter.trackPlatformActivity`
 * (issue #271 — PostHog replaces the Mongo activity log); tests
 * inject a spy. Emit failures NEVER block the response — the action
 * already succeeded by the time we log.
 *
 * @module domains/settings/exportImport/routes
 */

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import pino from "pino";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";
import type { SettingsActor } from "../types";
import type { SettingsExporter } from "./exporter";
import type { ImportResult, SettingsImporter } from "./importer";

const logger = pino({ level: "info" }).child({ module: "settingsExportImportRoutes" });

/**
 * Settings audit hook. Bootstrap binds this to
 * `analyticsEmitter.trackPlatformActivity` with the
 * `settings.exported` / `settings.imported` action values; routes call
 * into this interface so this module stays decoupled from the
 * underlying tracker.
 *
 * Implementations MUST NOT throw — the audit pipeline is best-effort.
 */
export interface SettingsAuditLogger {
  recordExport(args: {
    actor: SettingsActor;
    schemaVersion: number;
  }): Promise<void>;
  recordImport(args: {
    actor: SettingsActor;
    schemaVersion: number;
    aggregateStatus: ImportResult["aggregateStatus"];
    sections: ReadonlyArray<{
      id: string;
      status: string;
      changedFields?: ReadonlyArray<string>;
    }>;
    dryRun: boolean;
  }): Promise<void>;
}

const noopAuditLogger: SettingsAuditLogger = {
  async recordExport() {},
  async recordImport() {},
};

export interface ExportImportRoutesConfig {
  readonly exporter: SettingsExporter;
  readonly importer: SettingsImporter;
  /** Used in the export filename. Default: `prod`. */
  readonly envName?: string;
  /** Audit hook. When omitted, exports/imports go un-audited (test mode). */
  readonly auditLogger?: SettingsAuditLogger;
  /** Body-size cap on `POST /import`. Default 1 MiB. */
  readonly importMaxBytes?: number;
}

export function createSettingsExportImportRoutes(
  config: ExportImportRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { exporter, importer } = config;
  const envName = config.envName ?? "prod";
  const audit = config.auditLogger ?? noopAuditLogger;
  const importMaxBytes = config.importMaxBytes ?? 1_048_576;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();
  const adminGuard = requirePermission("ornn:admin:skill");

  app.get("/admin/settings/export", auth, adminGuard, async (c) => {
    const envelope = await exporter.export();
    const filename = exporter.filenameFor(envName);
    // Surface the suggested filename for clients that want it; the
    // browser SPA serializes the JSON itself for the download blob.
    c.header("Content-Disposition", `attachment; filename="${filename}"`);
    // Fire-and-forget audit emission; never blocks the download.
    void audit
      .recordExport({
        actor: currentActor(c),
        schemaVersion: envelope.schemaVersion,
      })
      .catch((err) =>
        logger.warn({ err }, "settings.export audit emit failed — ignoring"),
      );
    // Wrap in the standard `{ data, error }` envelope so apiGet on the
    // SPA side can parse it like every other endpoint. Was returning
    // raw JSON before — that broke the SPA's downloader (#330).
    return c.json({ data: envelope, error: null });
  });

  app.post(
    "/admin/settings/import",
    auth,
    adminGuard,
    bodyLimit({
      maxSize: importMaxBytes,
      onError: (c) =>
        c.json(
          {
            data: null,
            error: {
              code: "payload_too_large",
              message: `import body must be ≤ ${importMaxBytes} bytes`,
            },
          },
          413,
        ),
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      if (!body || typeof body !== "object") {
        throw AppError.badRequest("invalid_body", "JSON body required");
      }
      // Accept dryRun from either the body (the SPA path) OR the
      // query string (curl / scripts). Body takes precedence. Was
      // query-only before — that silently mutated on the SPA's
      // "preview" button (#330).
      const dryRun =
        (body as { dryRun?: unknown }).dryRun === true ||
        c.req.query("dryRun") === "1" ||
        c.req.query("dryRun") === "true";
      const actor = currentActor(c);
      const result = await importer.import(body, actor, { dryRun });
      void audit
        .recordImport({
          actor,
          schemaVersion: result.schemaVersion,
          aggregateStatus: result.aggregateStatus,
          sections: result.sections.map((s) => ({
            id: s.id,
            status: s.status,
            changedFields: s.changedFields,
          })),
          dryRun,
        })
        .catch((err) =>
          logger.warn({ err }, "settings.import audit emit failed — ignoring"),
        );
      return c.json({ data: result, error: null });
    },
  );

  return app;
}

function currentActor(c: { get: (k: string) => unknown }): SettingsActor {
  const a = c.get("auth") as
    | { userId?: string; email?: string; displayName?: string }
    | undefined;
  return {
    userId: a?.userId ?? "unknown",
    email: a?.email ?? "unknown@local",
    displayName: a?.displayName,
  };
}
