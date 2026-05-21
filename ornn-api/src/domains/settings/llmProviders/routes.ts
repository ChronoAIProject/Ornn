/**
 * Admin LLM-providers routes (Story 7.1 + #270 — per-provider model
 * management).
 *
 *   GET    /admin/settings/llm-providers
 *   POST   /admin/settings/llm-providers
 *   GET    /admin/settings/llm-providers/:id
 *   PUT    /admin/settings/llm-providers/:id
 *   DELETE /admin/settings/llm-providers/:id
 *   POST   /admin/settings/llm-providers/:id/sync
 *   PATCH  /admin/settings/llm-providers/:id/models/:modelId   (#270)
 *
 * The PATCH endpoint is the single write path for per-model surface
 * flags (`enabledForPlayground`, `enabledForSkillGen`,
 * `defaultForPlayground`, `defaultForSkillGen`). The service layer
 * enforces:
 *   - at-most-one default per surface across all providers,
 *   - `defaultForX: true` ⇒ `enabledForX: true`,
 *   - cannot patch a row marked `removed: true`.
 *
 * Picker route is exported separately as `createLlmPickerRoutes` —
 * different mount path (`/me/models`) and a softer auth gate
 * (authenticated user, no admin permission).
 *
 * @module domains/settings/llmProviders/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";
import { validateBody, getValidatedBody } from "../../../middleware/validate";
import type { SettingsActor } from "../types";
import type { LlmProvidersService, ModelResolution, Surface } from "./service";

const surfaceSchema = z.enum(["playground", "skillGen"]);

/**
 * Translate a `ModelResolution` failure into an HTTP error. Shared
 * helper for the playground + skill-gen execute paths so they emit
 * consistent codes / messages.
 */
export function throwModelResolutionError(resolution: ModelResolution): never {
  if (resolution.kind === "ok") {
    throw new Error("throwModelResolutionError called on ok resolution");
  }
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

export interface LlmProvidersRoutesConfig {
  readonly llmProvidersService: LlmProvidersService;
  /**
   * Resolve the per-surface section default model id (#607). When set,
   * `GET /me/models?surface=…` uses it as the picker's `default` slot
   * so the frontend pre-selection agrees with the execute path's
   * `resolveSurfaceDefaults` precedence. Optional so legacy callers
   * (route-only tests, the admin route bundle) can skip wiring it.
   */
  readonly sectionDefaultResolver?: (
    surface: Surface,
  ) => Promise<string | null>;
}

export function createLlmProvidersRoutes(
  config: LlmProvidersRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { llmProvidersService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();
  const adminGuard = requirePermission("ornn:admin:skill");
  const base = "/admin/settings/llm-providers";

  app.get(base, auth, adminGuard, async (c) => {
    const items = await llmProvidersService.listForAdmin();
    return c.json({ data: { items }, error: null });
  });

  app.post(
    base,
    auth,
    adminGuard,
    // Service-internal Zod schemas (`providerCreateSchema`) enforce
    // the full shape. The middleware here just gates JSON-shape so a
    // SyntaxError becomes 400 with RFC 7807 envelope (#438).
    validateBody(z.record(z.string(), z.unknown()), "invalid_body"),
    async (c) => {
      const body = getValidatedBody<Record<string, unknown>>(c);
      const actor = currentActor(c);
      const created = await llmProvidersService.create(body, actor);
      // Re-fetch through the admin path so the 201 body never carries
      // the plaintext secret the caller just submitted.
      const masked = await llmProvidersService.getForAdmin(created._id);
      return c.json({ data: masked, error: null }, 201);
    },
  );

  app.get(`${base}/:id`, auth, adminGuard, async (c) => {
    const id = c.req.param("id");
    const item = await llmProvidersService.getForAdmin(id);
    if (!item) {
      throw AppError.notFound("provider_not_found", `No provider ${id}`);
    }
    return c.json({ data: item, error: null });
  });

  app.put(
    `${base}/:id`,
    auth,
    adminGuard,
    validateBody(z.record(z.string(), z.unknown()), "invalid_body"),
    async (c) => {
      const id = c.req.param("id");
      const body = getValidatedBody<Record<string, unknown>>(c);
      const actor = currentActor(c);
      await llmProvidersService.update(id, body, actor);
      const masked = await llmProvidersService.getForAdmin(id);
      return c.json({ data: masked, error: null });
    },
  );

  app.delete(`${base}/:id`, auth, adminGuard, async (c) => {
    const id = c.req.param("id");
    const ok = await llmProvidersService.deleteById(id);
    if (!ok) {
      throw AppError.notFound("provider_not_found", `No provider ${id}`);
    }
    return c.body(null, 204);
  });

  app.post(`${base}/:id/sync`, auth, adminGuard, async (c) => {
    const id = c.req.param("id");
    const actor = currentActor(c);
    const { result } = await llmProvidersService.sync(id, actor);
    const masked = await llmProvidersService.getForAdmin(id);
    return c.json({ data: { provider: masked, result }, error: null });
  });

  /**
   * Per-model surface-flag patch. The body MAY contain any subset of
   * `enabledForPlayground`, `enabledForSkillGen`, `defaultForPlayground`,
   * `defaultForSkillGen` — anything absent is preserved. See
   * `LlmProvidersService.patchModel` for the invariants enforced.
   */
  app.patch(
    `${base}/:id/models/:modelId`,
    auth,
    adminGuard,
    validateBody(z.record(z.string(), z.unknown()), "invalid_body"),
    async (c) => {
      const providerId = c.req.param("id");
      const modelId = c.req.param("modelId");
      const body = getValidatedBody<Record<string, unknown>>(c);
      const actor = currentActor(c);
      await llmProvidersService.patchModel(providerId, modelId, body, actor);
      const masked = await llmProvidersService.getForAdmin(providerId);
      return c.json({ data: masked, error: null });
    },
  );

  return app;
}

/**
 * Picker route — `GET /me/models?surface=playground|skillGen`.
 * Authenticated user only (no admin permission). Returns enabled,
 * non-removed models across every provider for the requested surface,
 * sorted with the surface default first. Replaces the legacy
 * `/api/v1/me/models` route from `domains/models/` removed in #270.
 */
export function createLlmPickerRoutes(
  config: LlmProvidersRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { llmProvidersService, sectionDefaultResolver } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  app.get("/me/models", auth, async (c) => {
    const surfaceRaw = c.req.query("surface");
    const parsed = surfaceSchema.safeParse(surfaceRaw);
    if (!parsed.success) {
      throw AppError.badRequest(
        "invalid_surface",
        "Query param 'surface' must be 'playground' or 'skillGen'",
      );
    }
    const surface: Surface = parsed.data;
    // #607 — pass the section-level pin through so the picker's
    // default agrees with the execute path. Resolver is optional;
    // tests that don't wire it fall back to the per-model flag.
    const sectionDefault = sectionDefaultResolver
      ? (await sectionDefaultResolver(surface)) ?? undefined
      : undefined;
    const result = await llmProvidersService.listPickerModels(
      surface,
      sectionDefault,
    );
    return c.json({
      data: {
        items: result.items.map((r) => ({
          modelId: r.modelId,
          displayName: r.displayName,
          isDefault: r.isDefault,
        })),
        defaultModelId: result.default,
      },
      error: null,
    });
  });

  return app;
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
