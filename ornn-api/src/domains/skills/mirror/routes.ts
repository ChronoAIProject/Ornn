/**
 * Admin endpoints for the GitHub mirror.
 *
 * Mounted under `/api/v1` like other domain routes. Right now there's
 * just one operation — manual full reconcile — gated on
 * `ornn:admin:skill`. The hourly k8s CronJob fires this same endpoint
 * (or invokes the service directly via a one-shot worker) to catch
 * any state the publish-time webhook may have dropped.
 *
 * @module domains/skills/mirror/routes
 */

import { Hono } from "hono";
import pino from "pino";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import type { MirrorService } from "./mirrorService";

const logger = pino({ level: "info" }).child({ module: "mirrorRoutes" });

export interface MirrorRoutesConfig {
  /**
   * The mirror service. Optional so deployments with the feature
   * disabled can still mount the route — it returns a 503 in that
   * case rather than 404, so operators get a clear error message.
   */
  mirrorService?: MirrorService;
}

export function createMirrorRoutes(
  config: MirrorRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { mirrorService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  /**
   * POST /admin/mirror/reconcile — run a full sweep against the GitHub
   * mirror. Eligible (`isPrivate: false`) skills are reflected; any
   * folders for skills that are no longer eligible (or no longer
   * exist) are deleted. Single atomic commit per call. Returns the
   * counts so a CronJob can log them or alert on unexpected churn.
   */
  app.post(
    "/admin/mirror/reconcile",
    auth,
    requirePermission("ornn:admin:skill"),
    async (c) => {
      if (!mirrorService) {
        return c.json(
          {
            data: null,
            error: {
              code: "MIRROR_DISABLED",
              message:
                "GitHub mirror is not enabled in this deployment. Set GITHUB_MIRROR_ENABLED=true and supply credentials.",
            },
          },
          503,
        );
      }
      const t0 = Date.now();
      const result = await mirrorService.reconcileAll();
      const durationMs = Date.now() - t0;
      logger.info({ ...result, durationMs }, "mirror reconcile completed");
      return c.json({ data: { ...result, durationMs }, error: null });
    },
  );

  return app;
}
