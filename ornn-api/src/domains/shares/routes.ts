/**
 * Share-request HTTP routes.
 *
 *   POST /api/v1/skills/:idOrName/share          — initiate share
 *   GET  /api/v1/shares/:requestId               — status + findings
 *   POST /api/v1/shares/:requestId/justification — owner submits justifications
 *   POST /api/v1/shares/:requestId/review        — reviewer accept/reject
 *   POST /api/v1/shares/:requestId/cancel        — owner cancels
 *   GET  /api/v1/shares                          — caller's own share requests
 *   GET  /api/v1/shares/review-queue             — pending reviews the caller can act on
 *
 * @module domains/shares/routes
 */

import { Hono } from "hono";
import pino from "pino";
import {
  type AuthVariables,
  getAuth,
  nyxidAuthMiddleware,
  readUserOrgIds,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import type { ShareService } from "./service";
import type { ShareTarget } from "./types";

const logger = pino({ level: "info" }).child({ module: "shareRoutes" });

export interface ShareRoutesConfig {
  shareService: ShareService;
}

export function createShareRoutes(config: ShareRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { shareService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  // ---- Initiate share -----------------------------------------------------
  app.post(
    "/skills/:idOrName/share",
    auth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const authCtx = getAuth(c);
      const body = (await c.req.json().catch(() => ({}))) as {
        targetType?: unknown;
        targetId?: unknown;
      };
      const target = parseTarget(body);
      const request = await shareService.initiateShare({
        skillIdOrName: idOrName,
        ownerUserId: authCtx.userId,
        target,
      });
      logger.info(
        { shareRequestId: request._id, skillIdOrName: idOrName, ownerUserId: authCtx.userId },
        "Share initiated via API",
      );
      return c.json({ data: request, error: null });
    },
  );

  // Order matters: the specific paths (`/shares`, `/shares/review-queue`)
  // MUST be registered before the wildcard `/shares/:requestId`. Hono
  // matches in definition order, so putting the dynamic one first makes
  // it swallow `review-queue` as if it were a requestId and 404.

  // ---- Caller's own share requests ---------------------------------------
  app.get(
    "/shares",
    auth,
    async (c) => {
      const authCtx = getAuth(c);
      const items = await shareService.listMine(authCtx.userId);
      return c.json({ data: { items }, error: null });
    },
  );

  // ---- Reviewer queue -----------------------------------------------------
  app.get(
    "/shares/review-queue",
    auth,
    async (c) => {
      const authCtx = getAuth(c);
      const reviewerOrgIds = await readUserOrgIds(c);
      const isPlatformAdmin = authCtx.permissions.includes("ornn:admin:skill");
      const items = await shareService.listReviewQueue({
        reviewerUserId: authCtx.userId,
        reviewerOrgIds,
        isPlatformAdmin,
      });
      return c.json({ data: { items }, error: null });
    },
  );

  // ---- Read a single request ---------------------------------------------
  app.get(
    "/shares/:requestId",
    auth,
    async (c) => {
      const requestId = c.req.param("requestId");
      const authCtx = getAuth(c);
      const isPlatformAdmin = authCtx.permissions.includes("ornn:admin:skill");
      const request = await shareService.get(requestId, authCtx.userId, isPlatformAdmin);
      return c.json({ data: request, error: null });
    },
  );

  // ---- Owner: submit justifications --------------------------------------
  app.post(
    "/shares/:requestId/justification",
    auth,
    async (c) => {
      const requestId = c.req.param("requestId");
      const authCtx = getAuth(c);
      const body = (await c.req.json().catch(() => ({}))) as {
        whyCannotPass?: unknown;
        whySafe?: unknown;
        whyShare?: unknown;
      };
      const updated = await shareService.submitJustification(requestId, authCtx.userId, {
        whyCannotPass: String(body.whyCannotPass ?? ""),
        whySafe: String(body.whySafe ?? ""),
        whyShare: String(body.whyShare ?? ""),
      });
      return c.json({ data: updated, error: null });
    },
  );

  // ---- Reviewer: accept/reject -------------------------------------------
  app.post(
    "/shares/:requestId/review",
    auth,
    async (c) => {
      const requestId = c.req.param("requestId");
      const authCtx = getAuth(c);
      const body = (await c.req.json().catch(() => ({}))) as {
        decision?: unknown;
        note?: unknown;
      };
      if (body.decision !== "accept" && body.decision !== "reject") {
        throw AppError.badRequest(
          "INVALID_DECISION",
          "'decision' must be 'accept' or 'reject'",
        );
      }
      const reviewerOrgIds = await readUserOrgIds(c);
      const isPlatformAdmin = authCtx.permissions.includes("ornn:admin:skill");
      const updated = await shareService.review(
        requestId,
        authCtx.userId,
        reviewerOrgIds,
        isPlatformAdmin,
        body.decision,
        typeof body.note === "string" ? body.note : undefined,
      );
      return c.json({ data: updated, error: null });
    },
  );

  // ---- Owner: cancel ------------------------------------------------------
  app.post(
    "/shares/:requestId/cancel",
    auth,
    async (c) => {
      const requestId = c.req.param("requestId");
      const authCtx = getAuth(c);
      const updated = await shareService.cancel(requestId, authCtx.userId);
      return c.json({ data: updated, error: null });
    },
  );

  return app;
}

function parseTarget(body: { targetType?: unknown; targetId?: unknown }): ShareTarget {
  const targetType = body.targetType;
  if (targetType !== "user" && targetType !== "org" && targetType !== "public") {
    throw AppError.badRequest(
      "INVALID_SHARE_TARGET",
      "'targetType' must be 'user', 'org', or 'public'",
    );
  }
  if (targetType === "public") {
    return { type: "public" };
  }
  const id = body.targetId;
  if (typeof id !== "string" || !id) {
    throw AppError.badRequest(
      "INVALID_SHARE_TARGET",
      `'targetId' is required for targetType '${targetType}'`,
    );
  }
  return { type: targetType, id };
}
