/**
 * Admin redemption-code HTTP surface.
 *
 *   POST   /api/v1/admin/redemption-codes              — mint
 *   GET    /api/v1/admin/redemption-codes              — paginated list
 *   GET    /api/v1/admin/redemption-codes/:id          — detail
 *   POST   /api/v1/admin/redemption-codes/:id/invalidate
 *
 * All gated on `QUOTA_ADMIN_PERMISSION` — issuance is a deferred quota
 * grant, so it sits at the same trust level as direct grants.
 *
 * @module domains/admin/redemption-codes/routes
 */

import { Hono } from "hono";
import pino from "pino";
import {
  type AuthVariables,
  getAuth,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../../middleware/validate";
import { AppError } from "../../../shared/types/index";
import { QUOTA_ADMIN_PERMISSION } from "../../quota/types";
import type { RedemptionCodeService } from "../../redemption-codes/service";
import {
  REDEMPTION_CODE_STATUSES,
  mintCodeSchema,
  type MintCodeInput,
  type RedemptionCodeDoc,
  type RedemptionCodeStatus,
} from "../../redemption-codes/types";

const logger = pino({ level: "info" }).child({ module: "adminRedemptionCodeRoutes" });

const PAGE_SIZE_MAX = 100;
const PAGE_SIZE_DEFAULT = 20;

export interface AdminRedemptionCodesRoutesConfig {
  readonly redemptionCodeService: RedemptionCodeService;
}

function serializeCode(doc: RedemptionCodeDoc): Record<string, unknown> {
  return {
    id: doc._id,
    code: doc.code,
    grants: doc.grants,
    note: doc.note ?? null,
    status: doc.status,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
    createdBy: doc.createdBy,
    expiresAt: doc.expiresAt instanceof Date ? doc.expiresAt.toISOString() : String(doc.expiresAt),
    redeemedAt:
      doc.redeemedAt instanceof Date ? doc.redeemedAt.toISOString() : doc.redeemedAt ?? null,
    redeemedBy: doc.redeemedBy ?? null,
    invalidatedAt:
      doc.invalidatedAt instanceof Date
        ? doc.invalidatedAt.toISOString()
        : doc.invalidatedAt ?? null,
    invalidatedBy: doc.invalidatedBy ?? null,
  };
}

function mapInvalidateError(message: string): AppError {
  if (message.startsWith("NOT_FOUND:")) {
    return new AppError(404, "REDEMPTION_CODE_NOT_FOUND", "Redemption code not found");
  }
  if (message.startsWith("ALREADY_REDEEMED:")) {
    return new AppError(
      409,
      "REDEMPTION_CODE_ALREADY_REDEEMED",
      "Redeemed codes cannot be invalidated",
    );
  }
  if (message.startsWith("ALREADY_INVALIDATED:")) {
    return new AppError(
      409,
      "REDEMPTION_CODE_ALREADY_INVALIDATED",
      "Code is already invalidated",
    );
  }
  return AppError.internalError("REDEMPTION_CODE_INVALIDATE_FAILED", message);
}

export function createAdminRedemptionCodesRoutes(
  config: AdminRedemptionCodesRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { redemptionCodeService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  // POST /admin/redemption-codes — mint
  app.post(
    "/admin/redemption-codes",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    validateBody(mintCodeSchema, "INVALID_REDEMPTION_CODE_BODY"),
    async (c) => {
      const authCtx = getAuth(c);
      const body = getValidatedBody<MintCodeInput>(c);
      try {
        const doc = await redemptionCodeService.mint({
          admin: {
            userId: authCtx.userId,
            email: authCtx.email,
            displayName: authCtx.displayName,
          },
          grants: body.grants,
          note: body.note,
          expiresAt: new Date(body.expiresAt),
        });
        logger.info(
          {
            codeId: doc._id,
            adminUserId: authCtx.userId,
            grantCount: doc.grants.length,
            expiresAt: doc.expiresAt.toISOString(),
          },
          "Admin minted redemption code",
        );
        return c.json({ data: { code: serializeCode(doc) }, error: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("INVALID_GRANTS:") || msg.startsWith("INVALID_EXPIRES_AT:")) {
          throw AppError.badRequest("INVALID_REDEMPTION_CODE_BODY", msg);
        }
        throw AppError.internalError("REDEMPTION_CODE_MINT_FAILED", msg);
      }
    },
  );

  // GET /admin/redemption-codes — list
  app.get(
    "/admin/redemption-codes",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      const statusParam = c.req.query("status");
      let status: RedemptionCodeStatus | undefined;
      if (statusParam) {
        if (!(REDEMPTION_CODE_STATUSES as readonly string[]).includes(statusParam)) {
          throw AppError.badRequest(
            "INVALID_STATUS",
            `status must be one of ${REDEMPTION_CODE_STATUSES.join(", ")}`,
          );
        }
        status = statusParam as RedemptionCodeStatus;
      }
      const search = (c.req.query("search") ?? c.req.query("q") ?? "").trim() || undefined;
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(
        PAGE_SIZE_MAX,
        Math.max(1, Number(c.req.query("pageSize")) || PAGE_SIZE_DEFAULT),
      );
      const result = await redemptionCodeService.list({ page, pageSize, status, search });
      return c.json({
        data: {
          items: result.items.map(serializeCode),
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
        },
        error: null,
      });
    },
  );

  // GET /admin/redemption-codes/:id — detail
  app.get(
    "/admin/redemption-codes/:id",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      const id = c.req.param("id");
      if (!id) {
        throw AppError.badRequest("INVALID_REDEMPTION_CODE_ID", "id is required");
      }
      const doc = await redemptionCodeService.findById(id);
      if (!doc) {
        throw new AppError(404, "REDEMPTION_CODE_NOT_FOUND", "Redemption code not found");
      }
      return c.json({ data: { code: serializeCode(doc) }, error: null });
    },
  );

  // POST /admin/redemption-codes/:id/invalidate
  app.post(
    "/admin/redemption-codes/:id/invalidate",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      const authCtx = getAuth(c);
      const id = c.req.param("id");
      if (!id) {
        throw AppError.badRequest("INVALID_REDEMPTION_CODE_ID", "id is required");
      }
      try {
        const doc = await redemptionCodeService.invalidate({
          id,
          admin: {
            userId: authCtx.userId,
            email: authCtx.email,
            displayName: authCtx.displayName,
          },
        });
        logger.info(
          { codeId: doc._id, adminUserId: authCtx.userId },
          "Admin invalidated redemption code",
        );
        return c.json({ data: { code: serializeCode(doc) }, error: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw mapInvalidateError(msg);
      }
    },
  );

  return app;
}
