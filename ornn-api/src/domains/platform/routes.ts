/**
 * Admin-only platform settings routes.
 *
 *   GET   /api/v1/admin/settings — read current settings
 *   PATCH /api/v1/admin/settings — update settings (partial)
 *
 * @module domains/platform/routes
 */

import { Hono } from "hono";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import type { PlatformSettingsService } from "./service";
import type { PlatformSettings } from "./types";

export interface PlatformSettingsRoutesConfig {
  readonly platformSettingsService: PlatformSettingsService;
}

export function createPlatformSettingsRoutes(
  config: PlatformSettingsRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { platformSettingsService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  app.get("/admin/settings", auth, requirePermission("ornn:admin:skill"), async (c) => {
    const settings = await platformSettingsService.get();
    return c.json({ data: settings, error: null });
  });

  app.patch("/admin/settings", auth, requirePermission("ornn:admin:skill"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<
      Record<keyof PlatformSettings, unknown>
    >;
    const patch: Partial<PlatformSettings> = {};

    if ("auditWaiverThreshold" in body) {
      const n = Number(body.auditWaiverThreshold);
      if (!Number.isFinite(n) || n < 0 || n > 10) {
        throw AppError.badRequest(
          "INVALID_SETTING",
          "'auditWaiverThreshold' must be a number between 0 and 10",
        );
      }
      patch.auditWaiverThreshold = Math.round(n * 10) / 10;
    }

    if (Object.keys(patch).length === 0) {
      throw AppError.badRequest("INVALID_SETTING", "No valid setting fields in body");
    }

    const updated = await platformSettingsService.patch(patch);
    return c.json({ data: updated, error: null });
  });

  return app;
}
