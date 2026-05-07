/**
 * Admin LLM-providers routes (Story 7.1).
 *   GET    /admin/settings/llm-providers
 *   POST   /admin/settings/llm-providers
 *   GET    /admin/settings/llm-providers/:id
 *   PUT    /admin/settings/llm-providers/:id
 *   DELETE /admin/settings/llm-providers/:id
 *   POST   /admin/settings/llm-providers/:id/sync
 *
 * @module domains/settings/llmProviders/routes
 */

import { Hono } from "hono";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";
import type { SettingsActor } from "../types";
import type { LlmProvidersService } from "./service";

export interface LlmProvidersRoutesConfig {
  readonly llmProvidersService: LlmProvidersService;
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

  app.post(base, auth, adminGuard, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) throw AppError.badRequest("INVALID_BODY", "JSON body required");
    const actor = currentActor(c);
    const created = await llmProvidersService.create(body, actor);
    // Re-fetch through the admin path so the 201 body never carries
    // the plaintext secret the caller just submitted.
    const masked = await llmProvidersService.getForAdmin(created._id);
    return c.json({ data: masked, error: null }, 201);
  });

  app.get(`${base}/:id`, auth, adminGuard, async (c) => {
    const id = c.req.param("id");
    const item = await llmProvidersService.getForAdmin(id);
    if (!item) {
      throw AppError.notFound("PROVIDER_NOT_FOUND", `No provider ${id}`);
    }
    return c.json({ data: item, error: null });
  });

  app.put(`${base}/:id`, auth, adminGuard, async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body) throw AppError.badRequest("INVALID_BODY", "JSON body required");
    const actor = currentActor(c);
    await llmProvidersService.update(id, body, actor);
    const masked = await llmProvidersService.getForAdmin(id);
    return c.json({ data: masked, error: null });
  });

  app.delete(`${base}/:id`, auth, adminGuard, async (c) => {
    const id = c.req.param("id");
    const ok = await llmProvidersService.deleteById(id);
    if (!ok) {
      throw AppError.notFound("PROVIDER_NOT_FOUND", `No provider ${id}`);
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
