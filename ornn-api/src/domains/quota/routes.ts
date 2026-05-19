/**
 * Quota HTTP surface — caller-facing only.
 *
 *   /api/v1/me/quota — caller snapshot (new shape: no `daily`).
 *
 * Admin endpoints live in `domains/admin/quota/routes.ts`.
 *
 * @module domains/quota/routes
 */

import { Hono } from "hono";
import {
  type AuthVariables,
  getAuth,
  nyxidAuthMiddleware,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import type { QuotaService } from "./service";
import { type Surface } from "./types";

export interface QuotaRoutesConfig {
  readonly quotaService: QuotaService;
}

export function createQuotaRoutes(
  config: QuotaRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { quotaService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  app.get("/me/quota", auth, async (c) => {
    const authCtx = getAuth(c);
    const snapshot = await quotaService.getSnapshot({
      userId: authCtx.userId,
      permissions: authCtx.permissions,
    });
    return c.json({ data: snapshot, error: null });
  });

  return app;
}

/**
 * Convenience helper for the playground / skill-gen routes: turn a
 * `QuotaDecision` failure into the standard 429 response shape.
 */
export function throwQuotaError(decision: {
  allowed: false;
  surface: Surface;
  message: string;
}): never {
  throw new AppError(429, "quota_exceeded", decision.message);
}
