/**
 * Wire the legacy platform-settings domain (#580 — bootstrap decomposition).
 *
 * This is the pre-#302 single-doc `platform_settings:{_id:"ornn"}`
 * surface (audit-waiver threshold + legacy mirror config + legacy LLM
 * override). Backend-engineer-2's multi-section `SettingsService`
 * replaced most of it; what remains is still consumed by the audit
 * waiver path + a handful of legacy routes, so we keep this wiring
 * alive until those sites migrate.
 *
 * @module domains/platform/bootstrap
 */

import type { Db } from "mongodb";
import type { Hono } from "hono";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { PlatformSettingsRepository } from "./repository";
import { PlatformSettingsService } from "./service";
import { createPlatformSettingsRoutes } from "./routes";

export interface PlatformSettingsWiring {
  readonly service: PlatformSettingsService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
}

export function wirePlatformSettings(deps: {
  db: Db;
  encryptionKey: string;
}): PlatformSettingsWiring {
  const repo = new PlatformSettingsRepository(deps.db);
  const service = new PlatformSettingsService(repo, {
    encryptionKey: deps.encryptionKey,
  });
  const routes = createPlatformSettingsRoutes({ platformSettingsService: service });
  return { service, routes };
}
