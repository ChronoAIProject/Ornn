/**
 * Launch-promo HTTP routes (#724).
 *
 *   GET    /me/launch-promo                     — caller's claim status
 *   POST   /admin/launch-promo/award/:userId    — admin manually award a user
 *   GET    /admin/launch-promo/recent           — admin observability
 *
 * The cron-poll endpoint will land in a follow-up PR with the GitHub
 * stargazers + NyxID GH-login pieces. The manual admin endpoint is
 * enough to honour the launch-promo promise today.
 *
 * @module domains/launchPromo/routes
 */

import { Hono } from "hono";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  getAuth,
  requirePermission,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import { createLogger } from "../../shared/logger";
import type { LaunchPromoService } from "./service";
import { LAUNCH_PROMO_ERROR_PREFIXES } from "./service";

const logger = createLogger("launchPromoRoutes");

export interface LaunchPromoRoutesConfig {
  service: LaunchPromoService;
}

/**
 * Translate service-layer error sentinels into the right HTTP status +
 * AppError code. Kept here (route-layer) so the service stays free of
 * HTTP concerns.
 */
function mapServiceError(err: unknown): AppError {
  const msg = err instanceof Error ? err.message : String(err);
  for (const prefix of LAUNCH_PROMO_ERROR_PREFIXES) {
    if (msg.startsWith(`${prefix}:`)) {
      switch (prefix) {
        case "PROMO_DISABLED":
          return AppError.badRequest("PROMO_DISABLED", msg);
        case "ALREADY_CLAIMED":
          return AppError.conflict("ALREADY_CLAIMED", msg);
        case "RANK_EXCEEDED":
          return AppError.forbidden("RANK_EXCEEDED", msg);
        case "SLOTS_EXHAUSTED":
          return AppError.conflict("SLOTS_EXHAUSTED", msg);
        case "USER_NOT_FOUND":
          return AppError.notFound("USER_NOT_FOUND", msg);
      }
    }
  }
  // Unmapped — bubble as 500 via the global error middleware.
  return AppError.internalError("LAUNCH_PROMO_ERROR", msg);
}

export function createLaunchPromoRoutes(
  config: LaunchPromoRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { service } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  // ---- Caller-scoped --------------------------------------------------

  app.get("/me/launch-promo", auth, async (c) => {
    const { userId } = getAuth(c);
    const status = await service.getStatusForUser(userId);
    return c.json({ data: status, error: null });
  });

  // ---- Admin ---------------------------------------------------------

  app.post(
    "/admin/launch-promo/award/:userId",
    auth,
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const targetUserId = c.req.param("userId");
      const { userId: adminId } = getAuth(c);
      try {
        const result = await service.awardUser({
          userId: targetUserId,
          awardedBy: adminId,
        });
        logger.info(
          { adminId, targetUserId, redemptionCodeId: result.claim.redemptionCodeId },
          "Launch-promo manual award succeeded",
        );
        return c.json({
          data: {
            claim: {
              userId: result.claim._id,
              eligibilityRank: result.claim.eligibilityRank,
              redemptionCodeId: result.claim.redemptionCodeId,
              redemptionCode: result.redemptionCode,
              awardedAt: result.claim.awardedAt.toISOString(),
              awardedBy: result.claim.awardedBy,
            },
          },
          error: null,
        });
      } catch (err) {
        throw mapServiceError(err);
      }
    },
  );

  app.get(
    "/admin/launch-promo/recent",
    auth,
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const limit = Math.max(1, Math.min(500, Number(c.req.query("limit") ?? 50) || 50));
      const items = await service.repoListRecent(limit);
      return c.json({
        data: {
          items: items.map((c) => ({
            userId: c._id,
            eligibilityRank: c.eligibilityRank,
            redemptionCodeId: c.redemptionCodeId,
            awardedAt: c.awardedAt.toISOString(),
            awardedBy: c.awardedBy,
            githubLogin: c.githubLogin ?? null,
          })),
        },
        error: null,
      });
    },
  );

  return app;
}
