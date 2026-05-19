/**
 * Per-section admin settings routes — `GET` + `PUT` for each section.
 *
 * Path layout matches Architecture §4.1:
 *   /api/v1/admin/settings/{playground|skill-generation|mirror|integrations/nyxid|integrations/services|skill-audit|telemetry|quota|extras}
 *
 * Secret fields are mid-masked on GET. PUT accepts plaintext, redaction
 * sentinels, or mid-mask sentinels for any secret field; the service
 * resolves "preserve DB" sentinels.
 *
 * @module domains/settings/routes
 */

import { Hono } from "hono";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import { midMaskSecret } from "../../infra/crypto";
import { sections, type SectionId } from "./sections";
import type { SettingsService, SettingsActor } from "./types";

export interface SettingsRoutesConfig {
  readonly settingsService: SettingsService;
}

/**
 * For each section we mount a `<publicPath>` GET + PUT pair. Secret
 * fields are mid-masked on the GET response.
 */
export function createSettingsRoutes(
  config: SettingsRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { settingsService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();
  const adminGuard = requirePermission("ornn:admin:skill");

  for (const id of Object.keys(sections) as SectionId[]) {
    const meta = sections[id];
    const path = `/admin/settings/${meta.publicPath}`;

    app.get(path, auth, adminGuard, async (c) => {
      const value = (await settingsService.getSection<Record<string, unknown>>(id));
      const masked = maskSecrets(value, meta.secretFields);
      return c.json({ data: masked, error: null });
    });

    app.put(path, auth, adminGuard, async (c) => {
      const body = await c.req.json().catch(() => null);
      if (!body || typeof body !== "object") {
        throw AppError.badRequest("invalid_body", "request body must be a JSON object");
      }
      const actor = currentActor(c);
      const result = await settingsService.putSection<Record<string, unknown>>(
        id,
        body as Record<string, unknown>,
        actor,
      );
      const masked = maskSecrets(result.value, meta.secretFields);
      return c.json({
        data: masked,
        error: null,
        meta: { changedFields: result.changedFields },
      });
    });
  }

  return app;
}

function maskSecrets(
  value: Record<string, unknown>,
  secretFields: ReadonlyArray<string>,
): Record<string, unknown> {
  if (secretFields.length === 0) return value;
  const out: Record<string, unknown> = { ...value };
  for (const field of secretFields) {
    const v = out[field];
    if (typeof v === "string") {
      out[field] = midMaskSecret(v);
    }
  }
  return out;
}

function currentActor(c: {
  get: (k: string) => unknown;
}): SettingsActor {
  const a = c.get("auth") as
    | { userId?: string; email?: string; displayName?: string }
    | undefined;
  return {
    userId: a?.userId ?? "unknown",
    email: a?.email ?? "unknown@local",
    displayName: a?.displayName,
  };
}
