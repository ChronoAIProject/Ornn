/**
 * Caller-scoped redemption-code routes.
 *
 *   POST /api/v1/me/redemption-codes/redeem    — consume a code.
 *   GET  /api/v1/me/redemption-codes/history   — paginated history.
 *
 * No admin permission required — any authenticated caller can redeem.
 * Quirk: admins reach `quotaService.grant()` here too, which lands a
 * grant on their (otherwise-bypassed) bucket. Functionally a no-op
 * because `chargeOnCompletion` early-returns for admins; we don't
 * special-case it.
 *
 * @module domains/redemption-codes/me-routes
 */

import { Hono } from "hono";
import pino from "pino";
import {
  type AuthVariables,
  getAuth,
  nyxidAuthMiddleware,
} from "../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../middleware/validate";
import { AppError } from "../../shared/types/index";
import type { RedemptionCodeService } from "./service";
import { redeemSchema, type RedeemInput, type RedemptionCodeDoc } from "./types";

const logger = pino({ level: "info" }).child({ module: "meRedemptionCodeRoutes" });

const HISTORY_PAGE_SIZE_MAX = 100;
const HISTORY_PAGE_SIZE_DEFAULT = 20;

export interface MeRedemptionCodesRoutesConfig {
  readonly redemptionCodeService: RedemptionCodeService;
}

function mapRedeemError(message: string): AppError {
  if (message.startsWith("NOT_FOUND:")) {
    return new AppError(404, "redemption_code_not_found", "Code not found");
  }
  if (message.startsWith("EXPIRED:")) {
    return new AppError(410, "redemption_code_expired", "This code has expired");
  }
  if (message.startsWith("ALREADY_INVALIDATED:")) {
    return new AppError(
      410,
      "redemption_code_invalidated",
      "This code has been revoked",
    );
  }
  if (message.startsWith("ALREADY_REDEEMED:")) {
    return new AppError(
      409,
      "redemption_code_already_redeemed",
      "This code has already been redeemed",
    );
  }
  return AppError.internalError("redemption_code_redeem_failed", message);
}

function serializeHistoryItem(doc: RedemptionCodeDoc): Record<string, unknown> {
  return {
    id: doc._id,
    code: doc.code,
    grants: doc.grants,
    note: doc.note ?? null,
    redeemedAt:
      doc.redeemedAt instanceof Date ? doc.redeemedAt.toISOString() : doc.redeemedAt ?? null,
    expiresAt: doc.expiresAt instanceof Date ? doc.expiresAt.toISOString() : String(doc.expiresAt),
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
  };
}

export function createMeRedemptionCodesRoutes(
  config: MeRedemptionCodesRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { redemptionCodeService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  // POST /me/redemption-codes/redeem
  app.post(
    "/me/redemption-codes/redeem",
    auth,
    validateBody(redeemSchema, "INVALID_REDEEM_BODY"),
    async (c) => {
      const authCtx = getAuth(c);
      const body = getValidatedBody<RedeemInput>(c);
      try {
        const result = await redemptionCodeService.redeem({
          code: body.code,
          redeemer: {
            userId: authCtx.userId,
            email: authCtx.email,
            displayName: authCtx.displayName,
          },
          permissions: authCtx.permissions,
        });
        logger.info(
          {
            codeId: result.code._id,
            redeemerUserId: authCtx.userId,
            grantCount: result.appliedGrants.length,
          },
          "User redeemed code",
        );
        return c.json({
          data: {
            codeId: result.code._id,
            redeemedAt:
              result.code.redeemedAt instanceof Date
                ? result.code.redeemedAt.toISOString()
                : new Date().toISOString(),
            grants: result.appliedGrants.map((g) => ({
              surface: g.surface,
              amount: g.amount,
              monthMarker: g.monthMarker,
              newAdminGrant: g.newAdminGrant,
            })),
          },
          error: null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw mapRedeemError(msg);
      }
    },
  );

  // GET /me/redemption-codes/history
  app.get("/me/redemption-codes/history", auth, async (c) => {
    const authCtx = getAuth(c);
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    const pageSize = Math.min(
      HISTORY_PAGE_SIZE_MAX,
      Math.max(1, Number(c.req.query("pageSize")) || HISTORY_PAGE_SIZE_DEFAULT),
    );
    const list = await redemptionCodeService.listRedeemedByUser(
      authCtx.userId,
      page,
      pageSize,
    );
    return c.json({
      data: {
        items: list.items.map(serializeHistoryItem),
        total: list.total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(list.total / pageSize)),
      },
      error: null,
    });
  });

  return app;
}
