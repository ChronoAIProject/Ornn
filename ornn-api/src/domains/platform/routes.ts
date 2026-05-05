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
import { isMidMaskSentinel, midMaskSecret } from "../../infra/crypto";
import type { PlatformSettingsService } from "./service";
import type { PlatformSettings } from "./types";

export interface PlatformSettingsRoutesConfig {
  readonly platformSettingsService: PlatformSettingsService;
}

/**
 * Mid-mask the apiKey on response so the admin sees which key is in
 * place (head + tail) without the body leaking through logs or
 * `kubectl describe`. Bullet character is the sentinel for "preserve
 * existing on PATCH" — legitimate keys never contain it.
 */
function maskLlmProvider(settings: PlatformSettings): PlatformSettings {
  return {
    ...settings,
    llmProvider: {
      gatewayUrl: settings.llmProvider.gatewayUrl,
      apiKey: midMaskSecret(settings.llmProvider.apiKey),
    },
  };
}

export function createPlatformSettingsRoutes(
  config: PlatformSettingsRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { platformSettingsService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  app.get("/admin/settings", auth, requirePermission("ornn:admin:skill"), async (c) => {
    const settings = await platformSettingsService.get();
    return c.json({ data: maskLlmProvider(settings), error: null });
  });

  app.patch("/admin/settings", auth, requirePermission("ornn:admin:skill"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<
      Record<keyof PlatformSettings, unknown>
    >;
    type MutablePatch = { -readonly [K in keyof PlatformSettings]?: PlatformSettings[K] };
    const patch: MutablePatch = {};

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

    if ("llmProvider" in body) {
      const lp = body.llmProvider;
      if (!lp || typeof lp !== "object") {
        throw AppError.badRequest(
          "INVALID_SETTING",
          "'llmProvider' must be an object with optional gatewayUrl + apiKey",
        );
      }
      const lpObj = lp as Record<string, unknown>;
      const next = { gatewayUrl: "", apiKey: "" };

      if ("gatewayUrl" in lpObj) {
        const u = lpObj.gatewayUrl;
        if (typeof u !== "string") {
          throw AppError.badRequest(
            "INVALID_SETTING",
            "'llmProvider.gatewayUrl' must be a string (empty = use env default)",
          );
        }
        const trimmed = u.trim();
        if (trimmed.length > 0) {
          try {
            new URL(trimmed); // validate
          } catch {
            throw AppError.badRequest(
              "INVALID_SETTING",
              "'llmProvider.gatewayUrl' must be a valid URL",
            );
          }
        }
        next.gatewayUrl = trimmed;
      } else {
        // Preserve existing on partial PATCH.
        const existing = await platformSettingsService.getLlmProviderConfig();
        next.gatewayUrl = existing.gatewayUrl;
      }

      if ("apiKey" in lpObj) {
        const k = lpObj.apiKey;
        if (typeof k !== "string") {
          throw AppError.badRequest(
            "INVALID_SETTING",
            "'llmProvider.apiKey' must be a string (empty = clear)",
          );
        }
        // The mid-mask sentinel uses the bullet character (•) which is
        // never present in a real bearer key. If the inbound value
        // contains a bullet anywhere, the frontend round-tripped the
        // existing display value — preserve the stored key as-is.
        if (isMidMaskSentinel(k)) {
          const existing = await platformSettingsService.getLlmProviderConfig();
          next.apiKey = existing.apiKey;
        } else {
          next.apiKey = k.trim();
        }
      } else {
        const existing = await platformSettingsService.getLlmProviderConfig();
        next.apiKey = existing.apiKey;
      }
      patch.llmProvider = next;
    }

    if (Object.keys(patch).length === 0) {
      throw AppError.badRequest("INVALID_SETTING", "No valid setting fields in body");
    }

    const updated = await platformSettingsService.patch(patch);
    return c.json({ data: maskLlmProvider(updated), error: null });
  });

  return app;
}
