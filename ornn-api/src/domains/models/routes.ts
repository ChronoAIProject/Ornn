/**
 * Model catalog HTTP surface.
 *
 *   GET   /me/models?surface=playground|skillGen — picker (enabled-only).
 *   GET   /admin/models?includeArchived=true     — admin catalog list.
 *   POST  /admin/models/refresh                  — pull upstream + upsert.
 *   PATCH /admin/models/:modelId                 — toggle flags.
 *
 * Admin routes share the existing `ornn:admin:skill` permission gate.
 *
 * @module domains/models/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import pino from "pino";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../middleware/validate";
import { AppError } from "../../shared/types/index";
import type { ModelsService } from "./service";
import { MODEL_ADMIN_PERMISSION } from "./types";
import { SURFACES, type Surface } from "../quota/types";

const logger = pino({ level: "info" }).child({ module: "modelsRoutes" });

const surfaceQuerySchema = z.enum(SURFACES);

const patchFlagsSchema = z
  .object({
    enabledForPlayground: z.boolean().optional(),
    enabledForSkillGen: z.boolean().optional(),
    defaultForPlayground: z.boolean().optional(),
    defaultForSkillGen: z.boolean().optional(),
  })
  .refine(
    (val) => Object.keys(val).length > 0,
    "At least one flag must be provided",
  );

export interface ModelsRoutesConfig {
  readonly modelsService: ModelsService;
}

export function createModelsRoutes(
  config: ModelsRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { modelsService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  // -------------------------------------------------------------------------
  // GET /me/models — user-side picker
  // -------------------------------------------------------------------------
  app.get("/me/models", auth, async (c) => {
    const surfaceRaw = c.req.query("surface");
    const surfaceParse = surfaceQuerySchema.safeParse(surfaceRaw);
    if (!surfaceParse.success) {
      throw AppError.badRequest(
        "INVALID_SURFACE",
        "Query param 'surface' must be 'playground' or 'skillGen'",
      );
    }
    const surface: Surface = surfaceParse.data;
    const result = await modelsService.listPickerModels(surface);
    return c.json({ data: result, error: null });
  });

  // -------------------------------------------------------------------------
  // GET /admin/models — full catalog (active + optionally archived)
  // -------------------------------------------------------------------------
  app.get(
    "/admin/models",
    auth,
    requirePermission(MODEL_ADMIN_PERMISSION),
    async (c) => {
      const includeArchived = c.req.query("includeArchived") === "true";
      const items = await modelsService.listAdminCatalog(includeArchived);
      return c.json({
        data: {
          items: items.map((m) => ({
            modelId: m.modelId,
            displayName: m.displayName,
            enabledForPlayground: m.enabledForPlayground,
            enabledForSkillGen: m.enabledForSkillGen,
            defaultForPlayground: m.defaultForPlayground,
            defaultForSkillGen: m.defaultForSkillGen,
            archived: m.archived,
            lastSyncedAt:
              m.lastSyncedAt instanceof Date
                ? m.lastSyncedAt.toISOString()
                : String(m.lastSyncedAt),
            createdAt:
              m.createdAt instanceof Date
                ? m.createdAt.toISOString()
                : String(m.createdAt),
          })),
          total: items.length,
        },
        error: null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /admin/models/refresh — pull upstream + upsert
  // -------------------------------------------------------------------------
  app.post(
    "/admin/models/refresh",
    auth,
    requirePermission(MODEL_ADMIN_PERMISSION),
    async (c) => {
      try {
        const result = await modelsService.refresh();
        logger.info({ ...result }, "Model catalog refresh complete");
        return c.json({ data: result, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, "Model catalog refresh failed");
        throw AppError.internalError("MODELS_REFRESH_FAILED", message);
      }
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /admin/models/:modelId — toggle flags
  // -------------------------------------------------------------------------
  app.patch(
    "/admin/models/:modelId",
    auth,
    requirePermission(MODEL_ADMIN_PERMISSION),
    validateBody(patchFlagsSchema, "INVALID_MODEL_FLAGS"),
    async (c) => {
      const modelId = c.req.param("modelId");
      const body = getValidatedBody<z.infer<typeof patchFlagsSchema>>(c);
      const updated = await modelsService.patchFlags(modelId, body);
      if (!updated) {
        throw AppError.notFound("MODEL_NOT_FOUND", `Model '${modelId}' not found`);
      }
      return c.json({
        data: {
          modelId: updated.modelId,
          displayName: updated.displayName,
          enabledForPlayground: updated.enabledForPlayground,
          enabledForSkillGen: updated.enabledForSkillGen,
          defaultForPlayground: updated.defaultForPlayground,
          defaultForSkillGen: updated.defaultForSkillGen,
          archived: updated.archived,
        },
        error: null,
      });
    },
  );

  return app;
}

/**
 * Translate a `ModelResolution` failure into an HTTP error. Used by both
 * the playground and skill-gen routes so they share consistent codes
 * and messages.
 */
export function throwModelResolutionError(
  resolution: { kind: "not-enabled" | "not-found" | "no-models-enabled"; surface: Surface; modelId?: string },
): never {
  if (resolution.kind === "no-models-enabled") {
    const surfaceLabel =
      resolution.surface === "playground" ? "playground" : "skill-generation";
    throw AppError.serviceUnavailable(
      "MODEL_UNAVAILABLE",
      `${surfaceLabel} is temporarily unavailable — contact admin to enable a model.`,
    );
  }
  if (resolution.kind === "not-enabled") {
    throw AppError.badRequest(
      "MODEL_NOT_ENABLED",
      `Model '${resolution.modelId}' is not enabled for ${resolution.surface}`,
    );
  }
  throw AppError.badRequest(
    "MODEL_NOT_FOUND",
    `Model '${resolution.modelId}' not found in catalog`,
  );
}
