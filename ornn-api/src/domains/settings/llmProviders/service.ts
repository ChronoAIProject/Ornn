/**
 * LlmProvidersService — CRUD over the `llm_providers` collection plus
 * the model-list sync routine and the per-surface model resolver
 * (Story 7.1 + #270 — single-source per-provider model management).
 *
 * Sync semantics (Architecture §5.3):
 *   • Existing models keep their per-surface flags
 *     (`enabledForPlayground`, `enabledForSkillGen`,
 *     `defaultForPlayground`, `defaultForSkillGen`); their
 *     `lastSyncedAt` is bumped.
 *   • Models in the upstream catalog that the service has never seen
 *     before arrive with all four surface flags `false`,
 *     `removed: false`, `firstSeenAt = now`. Adding a row to the
 *     upstream catalog never auto-changes platform behavior.
 *   • Models the service knows about that are NO LONGER in the upstream
 *     catalog get `removed: true` but are kept for history. If a row
 *     was the surface default, the default flag is cleared in the
 *     same write — the resolver excludes `removed:true` rows.
 *   • A model whose `removed:true` row reappears upstream flips back to
 *     `removed:false`, preserving its prior flags.
 *
 * Sync is idempotent: re-running with the same upstream list yields
 * `{ added:0, updated:0, removed:0 }`.
 *
 * Per-model patching (`patchModel`) is the single write path for
 * surface flags. Setting `defaultForX: true` enforces three things in
 * the same write:
 *   1. clears `defaultForX` on every other model (any provider) for
 *      that surface,
 *   2. forces `enabledForX: true` on the chosen model (a default that
 *      isn't enabled is incoherent),
 *   3. refuses if the chosen model is `removed: true`.
 *
 * @module domains/settings/llmProviders/service
 */

import { randomUUID } from "node:crypto";
import pino from "pino";
import { z, ZodError } from "zod";
import {
  decryptSecret,
  encryptSecret,
  isPreserveSentinel,
  midMaskSecret,
} from "../../../infra/crypto";
import { PUBLIC_URL_REFUSAL, requirePublicUrl } from "../../../infra/url";
import { AppError } from "../../../shared/types/index";
import type { SettingsActor } from "../types";
import type {
  LlmProvidersRepository,
  StoredAuth,
  StoredProvider,
  SurfaceKey,
} from "./repository";
import type {
  ApiFormat,
  LlmProvider,
  LlmProviderAuth,
  LlmProviderModel,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "llmProvidersService" });

/** Surfaces the picker / resolver care about. Mirror of `quota/types.ts:Surface`. */
export type Surface = "playground" | "skillGen";

const SURFACE_KEY: Record<Surface, SurfaceKey> = {
  playground: "Playground",
  skillGen: "SkillGen",
};

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const apiFormatSchema = z.enum(["chat-completion", "responses"]);

const apiKeyAuthSchema = z.object({
  kind: z.literal("apiKey"),
  apiKey: z.string(),
});
const tokenUrlAuthSchema = z.object({
  kind: z.literal("tokenUrl"),
  tokenUrl: z.string().refine(requirePublicUrl, {
    message: PUBLIC_URL_REFUSAL,
  }),
  clientId: z.string().min(1),
  clientSecret: z.string(),
});
const basicAuthSchema = z.object({
  kind: z.literal("basic"),
  username: z.string().min(1),
  password: z.string(),
});

const authSchema = z.discriminatedUnion("kind", [
  apiKeyAuthSchema,
  tokenUrlAuthSchema,
  basicAuthSchema,
]);

/**
 * Models on POST/PUT bodies. The four surface flags are optional —
 * absent fields default to `false`, matching the sync semantics
 * (newly-discovered models never auto-route).
 */
const modelInputSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  enabledForPlayground: z.boolean().optional(),
  enabledForSkillGen: z.boolean().optional(),
  defaultForPlayground: z.boolean().optional(),
  defaultForSkillGen: z.boolean().optional(),
  removed: z.boolean().optional(),
});

export const providerCreateSchema = z.object({
  name: z.string().min(1).max(64),
  gatewayUrl: z.string().refine(requirePublicUrl, {
    message: PUBLIC_URL_REFUSAL,
  }),
  modelListUrl: z.string().refine(requirePublicUrl, {
    message: PUBLIC_URL_REFUSAL,
  }),
  apiFormat: apiFormatSchema,
  auth: authSchema,
  models: z.array(modelInputSchema).default([]),
  maxOutputTokens: z.number().int().min(1).max(1_000_000),
  defaultTemperature: z.number().min(0).max(2),
});

export type ProviderCreateInput = z.infer<typeof providerCreateSchema>;

export const providerUpdateSchema = providerCreateSchema.partial();
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>;

/**
 * `PATCH /admin/settings/llm-providers/:providerId/models/:modelId`
 * — partial update of a single model's surface flags. Anything absent
 * is preserved.
 */
export const modelFlagsPatchSchema = z
  .object({
    enabledForPlayground: z.boolean().optional(),
    enabledForSkillGen: z.boolean().optional(),
    defaultForPlayground: z.boolean().optional(),
    defaultForSkillGen: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one flag must be provided",
  });
export type ModelFlagsPatchInput = z.infer<typeof modelFlagsPatchSchema>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ModelListFetcher {
  /**
   * Return the upstream catalog of model ids/displayNames for a given
   * provider. The implementation knows how to interpret each
   * `apiFormat` (e.g. OpenAI `/v1/models` schema).
   */
  fetch(args: {
    modelListUrl: string;
    apiFormat: ApiFormat;
    auth: LlmProviderAuth;
  }): Promise<ReadonlyArray<{ id: string; displayName: string }>>;
}

export interface LlmProvidersServiceDeps {
  readonly repo: LlmProvidersRepository;
  readonly encryptionKey: string;
  readonly modelListFetcher: ModelListFetcher;
  readonly clock?: () => Date;
}

export interface ProviderSyncResult {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
}

/** Picker row returned to surface UIs. `isDefault` is the surface-scoped flag. */
export interface PickerModelRow {
  readonly modelId: string;
  readonly displayName: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly isDefault: boolean;
}

/** Resolution outcome for the execute path. Matches the legacy
 * `models/types.ts:ModelResolution` shape verbatim so consumers can
 * swap between the two during migration without changing their
 * error-mapping logic. */
export type ModelResolution =
  | { kind: "ok"; modelId: string; displayName: string; providerId: string }
  | { kind: "no-models-enabled"; surface: Surface }
  | { kind: "not-enabled"; surface: Surface; modelId: string }
  | { kind: "not-found"; surface: Surface; modelId: string };

export class LlmProvidersService {
  private readonly repo: LlmProvidersRepository;
  private readonly encryptionKey: string;
  private readonly modelListFetcher: ModelListFetcher;
  private readonly clock: () => Date;

  constructor(deps: LlmProvidersServiceDeps) {
    this.repo = deps.repo;
    this.encryptionKey = deps.encryptionKey;
    this.modelListFetcher = deps.modelListFetcher;
    this.clock = deps.clock ?? (() => new Date());
  }

  // ────────────────────────── read paths ──────────────────────────

  async list(): Promise<ReadonlyArray<LlmProvider>> {
    const stored = await this.repo.list();
    return stored.map((s) => this.toProvider(s));
  }

  async get(id: string): Promise<LlmProvider | null> {
    const stored = await this.repo.findById(id);
    return stored ? this.toProvider(stored) : null;
  }

  async listForAdmin(): Promise<ReadonlyArray<LlmProvider>> {
    return (await this.list()).map((p) => this.maskAuth(p));
  }
  async getForAdmin(id: string): Promise<LlmProvider | null> {
    const p = await this.get(id);
    return p ? this.maskAuth(p) : null;
  }

  /**
   * Surface-scoped picker. Returns every enabled, non-removed model
   * across all providers, sorted with the surface default first then
   * by display name. The first row's `modelId` is also exposed via
   * `default` for easy "what's the fallback?" UI.
   */
  async listPickerModels(surface: Surface): Promise<{
    items: PickerModelRow[];
    default: string | null;
  }> {
    const enabledField = enabledFieldFor(surface);
    const defaultField = defaultFieldFor(surface);
    const all = await this.repo.list();
    const items: PickerModelRow[] = [];
    for (const provider of all) {
      for (const m of provider.models) {
        if (m.removed) continue;
        if (m[enabledField] !== true) continue;
        items.push({
          modelId: m.id,
          displayName: m.displayName,
          providerId: provider._id,
          providerName: provider.name,
          isDefault: m[defaultField] === true,
        });
      }
    }
    items.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
    const def = items.find((i) => i.isDefault) ?? items[0] ?? null;
    return { items, default: def?.modelId ?? null };
  }

  /**
   * Resolve a request's chosen model to a (provider, model) pair.
   * Behaviour mirrors the legacy `ModelsService.resolveModel`:
   *
   *   - `requested` provided AND enabled+non-removed for surface ⇒ ok
   *     (first matching provider wins; ties broken by provider name).
   *   - `requested` provided but no enabled match ⇒ `not-enabled`.
   *   - `requested` provided and no row exists ⇒ `not-found`.
   *   - `requested` undefined ⇒ surface default; if no default, the
   *     first enabled row by display name; if none enabled,
   *     `no-models-enabled`.
   */
  async resolveModel(params: {
    surface: Surface;
    requested?: string;
  }): Promise<ModelResolution> {
    const surface = params.surface;
    const enabledField = enabledFieldFor(surface);
    const defaultField = defaultFieldFor(surface);
    const all = await this.repo.list();

    type Hit = { providerId: string; modelId: string; displayName: string };

    if (params.requested) {
      let foundAny = false;
      for (const provider of all) {
        for (const m of provider.models) {
          if (m.id !== params.requested) continue;
          if (m.removed) continue;
          foundAny = true;
          if (m[enabledField] === true) {
            return {
              kind: "ok",
              modelId: m.id,
              displayName: m.displayName,
              providerId: provider._id,
            };
          }
        }
      }
      if (!foundAny) {
        return { kind: "not-found", surface, modelId: params.requested };
      }
      return { kind: "not-enabled", surface, modelId: params.requested };
    }

    // No explicit request — pick the surface default, or the first enabled.
    const enabledList: Hit[] = [];
    let defaultMatch: Hit | null = null;
    for (const provider of all) {
      for (const m of provider.models) {
        if (m.removed) continue;
        if (m[enabledField] !== true) continue;
        const hit: Hit = {
          providerId: provider._id,
          modelId: m.id,
          displayName: m.displayName,
        };
        enabledList.push(hit);
        if (m[defaultField] === true && !defaultMatch) defaultMatch = hit;
      }
    }
    if (enabledList.length === 0) {
      return { kind: "no-models-enabled", surface };
    }
    enabledList.sort((a, b) => a.displayName.localeCompare(b.displayName));
    const winner = defaultMatch ?? enabledList[0];
    return {
      kind: "ok",
      modelId: winner.modelId,
      displayName: winner.displayName,
      providerId: winner.providerId,
    };
  }

  // ────────────────────────── write paths ──────────────────────────

  async create(
    input: unknown,
    actor: SettingsActor,
  ): Promise<LlmProvider> {
    const parsed = parse(providerCreateSchema, input);
    const existing = await this.repo.findByName(parsed.name);
    if (existing) {
      throw AppError.conflict(
        "PROVIDER_NAME_TAKEN",
        `Provider name "${parsed.name}" is already in use`,
      );
    }

    const now = this.clock();
    const id = randomUUID();
    const stored: StoredProvider = {
      _id: id,
      name: parsed.name,
      gatewayUrl: parsed.gatewayUrl,
      modelListUrl: parsed.modelListUrl,
      apiFormat: parsed.apiFormat,
      auth: this.encryptAuth(parsed.auth),
      models: parsed.models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        enabledForPlayground: m.enabledForPlayground === true,
        enabledForSkillGen: m.enabledForSkillGen === true,
        defaultForPlayground: m.defaultForPlayground === true,
        defaultForSkillGen: m.defaultForSkillGen === true,
        removed: m.removed === true,
        firstSeenAt: now,
        lastSyncedAt: now,
      })),
      maxOutputTokens: parsed.maxOutputTokens,
      defaultTemperature: parsed.defaultTemperature,
      createdAt: now,
      updatedAt: now,
      updatedBy: actor.userId,
    };
    await this.repo.insert(stored);
    logger.info(
      { providerId: id, name: parsed.name, actor: actor.userId },
      "LLM provider created",
    );
    return this.toProvider(stored);
  }

  async update(
    id: string,
    input: unknown,
    actor: SettingsActor,
  ): Promise<LlmProvider> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw AppError.notFound("provider_not_found", `No provider ${id}`);
    }
    const patch = parse(providerUpdateSchema, input);

    // Models update: if the caller passed `models`, replace the list
    // wholesale BUT preserve `firstSeenAt` for any incoming model that
    // already exists — only sync changes lifecycle dates.
    let models = existing.models;
    if (patch.models) {
      const now = this.clock();
      const previousMap = new Map(existing.models.map((m) => [m.id, m]));
      models = patch.models.map((m) => {
        const prev = previousMap.get(m.id);
        return {
          id: m.id,
          displayName: m.displayName,
          enabledForPlayground:
            m.enabledForPlayground ?? prev?.enabledForPlayground ?? false,
          enabledForSkillGen:
            m.enabledForSkillGen ?? prev?.enabledForSkillGen ?? false,
          defaultForPlayground:
            m.defaultForPlayground ?? prev?.defaultForPlayground ?? false,
          defaultForSkillGen:
            m.defaultForSkillGen ?? prev?.defaultForSkillGen ?? false,
          removed: m.removed ?? prev?.removed ?? false,
          firstSeenAt: prev?.firstSeenAt ?? now,
          lastSyncedAt: prev?.lastSyncedAt ?? now,
        };
      });
    }

    // Auth: sentinel handling — if the caller passes a sentinel for a
    // secret field, we keep the encrypted blob as-is.
    const auth = patch.auth
      ? this.encryptAuth(patch.auth, existing.auth)
      : existing.auth;

    const now = this.clock();
    const next: StoredProvider = {
      _id: existing._id,
      name: patch.name ?? existing.name,
      gatewayUrl: patch.gatewayUrl ?? existing.gatewayUrl,
      modelListUrl: patch.modelListUrl ?? existing.modelListUrl,
      apiFormat: patch.apiFormat ?? existing.apiFormat,
      auth,
      models,
      maxOutputTokens: patch.maxOutputTokens ?? existing.maxOutputTokens,
      defaultTemperature:
        patch.defaultTemperature ?? existing.defaultTemperature,
      createdAt: existing.createdAt,
      updatedAt: now,
      updatedBy: actor.userId,
    };
    await this.repo.replace(id, next);
    return this.toProvider(next);
  }

  async deleteById(id: string): Promise<boolean> {
    return this.repo.deleteById(id);
  }

  /**
   * Patch a single model's surface flags. Enforces:
   *   - if `defaultForX: true` is in the patch, also force `enabledForX: true`
   *     and clear `defaultForX` on every other model across all providers
   *   - if `enabledForX: false` is in the patch and the row is currently the
   *     surface default, clear `defaultForX` too (no incoherent "default but
   *     disabled" state)
   *   - reject if the model is `removed: true`
   *
   * Returns the updated provider doc.
   */
  async patchModel(
    providerId: string,
    modelId: string,
    input: unknown,
    actor: SettingsActor,
  ): Promise<LlmProvider> {
    const flags = parse(modelFlagsPatchSchema, input);
    const existing = await this.repo.findById(providerId);
    if (!existing) {
      throw AppError.notFound("provider_not_found", `No provider ${providerId}`);
    }
    const idx = existing.models.findIndex((m) => m.id === modelId);
    if (idx === -1) {
      throw AppError.notFound(
        "MODEL_NOT_FOUND",
        `Model "${modelId}" not on provider "${existing.name}"`,
      );
    }
    const current = existing.models[idx];
    if (current.removed) {
      throw AppError.badRequest(
        "MODEL_REMOVED",
        `Model "${modelId}" was removed upstream — re-sync to restore before flipping flags.`,
      );
    }

    // Compute the new flags, applying coherence rules.
    let next: LlmProviderModel = { ...current };

    for (const surface of ["playground", "skillGen"] as const) {
      const enKey = enabledFieldFor(surface);
      const defKey = defaultFieldFor(surface);
      if (flags[enKey] !== undefined) {
        next = { ...next, [enKey]: flags[enKey] === true };
        // Disabling clears the default — a default that isn't enabled
        // would silently mis-route the surface to a different model.
        if (flags[enKey] === false && next[defKey]) {
          next = { ...next, [defKey]: false };
        }
      }
      if (flags[defKey] !== undefined) {
        next = { ...next, [defKey]: flags[defKey] === true };
        // Setting default forces enabled — same incoherence-prevention.
        if (flags[defKey] === true) {
          next = { ...next, [enKey]: true };
        }
      }
    }

    // Cross-provider clears: for each surface where this row is now
    // the default, blow away the flag on every other model first.
    for (const surface of ["playground", "skillGen"] as const) {
      const defKey = defaultFieldFor(surface);
      if (next[defKey] === true) {
        await this.repo.clearDefaultsForSurfaceExcept(SURFACE_KEY[surface], {
          providerId,
          modelId,
        });
      }
    }

    // Re-fetch existing AFTER the cross-provider clears so the in-memory
    // copy of THIS provider reflects any sibling-row flips that landed
    // via the previous step.
    const refreshed = (await this.repo.findById(providerId))!;
    const merged = refreshed.models.map((m, i) =>
      i === idx
        ? {
            ...m,
            enabledForPlayground: next.enabledForPlayground,
            enabledForSkillGen: next.enabledForSkillGen,
            defaultForPlayground: next.defaultForPlayground,
            defaultForSkillGen: next.defaultForSkillGen,
          }
        : m,
    );
    const now = this.clock();
    await this.repo.replace(providerId, {
      ...refreshed,
      models: merged,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    logger.info(
      { providerId, modelId, flags, actor: actor.userId },
      "model flags patched",
    );
    const after = (await this.repo.findById(providerId))!;
    return this.toProvider(after);
  }

  // ────────────────────────── sync ──────────────────────────

  async sync(id: string, actor: SettingsActor): Promise<{
    provider: LlmProvider;
    result: ProviderSyncResult;
  }> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw AppError.notFound("provider_not_found", `No provider ${id}`);
    }
    const decryptedAuth = this.decryptAuth(existing.auth);
    let upstream: ReadonlyArray<{ id: string; displayName: string }>;
    try {
      upstream = await this.modelListFetcher.fetch({
        modelListUrl: existing.modelListUrl,
        apiFormat: existing.apiFormat,
        auth: decryptedAuth,
      });
    } catch (err) {
      logger.error(
        { providerId: id, err: (err as Error).message },
        "Model-list fetch failed",
      );
      throw AppError.serviceUnavailable(
        "MODEL_LIST_UNREACHABLE",
        "Provider model-list endpoint failed: " + (err as Error).message,
      );
    }

    const now = this.clock();
    const previousById = new Map(existing.models.map((m) => [m.id, m]));
    const upstreamIds = new Set(upstream.map((m) => m.id));

    let added = 0;
    let updated = 0;
    let removed = 0;

    const merged: LlmProviderModel[] = [];
    for (const u of upstream) {
      const prev = previousById.get(u.id);
      if (!prev) {
        merged.push({
          id: u.id,
          displayName: u.displayName,
          enabledForPlayground: false,
          enabledForSkillGen: false,
          defaultForPlayground: false,
          defaultForSkillGen: false,
          removed: false,
          firstSeenAt: now,
          lastSyncedAt: now,
        });
        added += 1;
        continue;
      }
      const wasRemoved = prev.removed;
      const displayChanged = prev.displayName !== u.displayName;
      if (wasRemoved || displayChanged) updated += 1;
      merged.push({
        id: prev.id,
        displayName: u.displayName,
        enabledForPlayground: prev.enabledForPlayground,
        enabledForSkillGen: prev.enabledForSkillGen,
        defaultForPlayground: prev.defaultForPlayground,
        defaultForSkillGen: prev.defaultForSkillGen,
        removed: false,
        firstSeenAt: prev.firstSeenAt,
        lastSyncedAt: now,
      });
    }
    // Keep history rows for models no longer in upstream — flag removed.
    // Default flags get cleared on removal (an absent model can't be the
    // surface default).
    for (const prev of existing.models) {
      if (upstreamIds.has(prev.id)) continue;
      const wasRemoved = prev.removed;
      merged.push({
        ...prev,
        removed: true,
        defaultForPlayground: false,
        defaultForSkillGen: false,
        lastSyncedAt: now,
      });
      if (!wasRemoved) removed += 1;
    }

    const next: StoredProvider = {
      ...existing,
      models: merged,
      updatedAt: now,
      updatedBy: actor.userId,
    };
    await this.repo.replace(id, next);
    logger.info(
      { providerId: id, added, updated, removed },
      "LLM provider sync complete",
    );
    return {
      provider: this.toProvider(next),
      result: { added, updated, removed },
    };
  }

  // ────────────────────────── helpers ──────────────────────────

  private toProvider(stored: StoredProvider): LlmProvider {
    return {
      _id: stored._id,
      name: stored.name,
      gatewayUrl: stored.gatewayUrl,
      modelListUrl: stored.modelListUrl,
      apiFormat: stored.apiFormat,
      auth: this.decryptAuth(stored.auth),
      models: stored.models,
      maxOutputTokens: stored.maxOutputTokens,
      defaultTemperature: stored.defaultTemperature,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      updatedBy: stored.updatedBy,
    };
  }

  private maskAuth(p: LlmProvider): LlmProvider {
    if (p.auth.kind === "apiKey") {
      return { ...p, auth: { ...p.auth, apiKey: midMaskSecret(p.auth.apiKey) } };
    }
    if (p.auth.kind === "tokenUrl") {
      return {
        ...p,
        auth: { ...p.auth, clientSecret: midMaskSecret(p.auth.clientSecret) },
      };
    }
    return {
      ...p,
      auth: { ...p.auth, password: midMaskSecret(p.auth.password) },
    };
  }

  private encryptAuth(input: LlmProviderAuth, previous?: StoredAuth): StoredAuth {
    if (input.kind === "apiKey") {
      const plain = isPreserveSentinel(input.apiKey)
        ? this.decryptIfMatches(previous, "apiKey")
        : input.apiKey;
      return {
        kind: "apiKey",
        apiKeyEnc: plain ? encryptSecret(plain, this.encryptionKey) : "",
      };
    }
    if (input.kind === "tokenUrl") {
      const plain = isPreserveSentinel(input.clientSecret)
        ? this.decryptIfMatches(previous, "clientSecret")
        : input.clientSecret;
      return {
        kind: "tokenUrl",
        tokenUrl: input.tokenUrl,
        clientId: input.clientId,
        clientSecretEnc: plain ? encryptSecret(plain, this.encryptionKey) : "",
      };
    }
    const plain = isPreserveSentinel(input.password)
      ? this.decryptIfMatches(previous, "password")
      : input.password;
    return {
      kind: "basic",
      username: input.username,
      passwordEnc: plain ? encryptSecret(plain, this.encryptionKey) : "",
    };
  }

  private decryptIfMatches(previous: StoredAuth | undefined, field: string): string {
    if (!previous) return "";
    if (field === "apiKey" && previous.kind === "apiKey") {
      return safeDecrypt(previous.apiKeyEnc ?? "", this.encryptionKey);
    }
    if (field === "clientSecret" && previous.kind === "tokenUrl") {
      return safeDecrypt(previous.clientSecretEnc ?? "", this.encryptionKey);
    }
    if (field === "password" && previous.kind === "basic") {
      return safeDecrypt(previous.passwordEnc ?? "", this.encryptionKey);
    }
    return "";
  }

  private decryptAuth(stored: StoredAuth): LlmProviderAuth {
    if (stored.kind === "apiKey") {
      return {
        kind: "apiKey",
        apiKey: safeDecrypt(stored.apiKeyEnc ?? "", this.encryptionKey),
      };
    }
    if (stored.kind === "tokenUrl") {
      return {
        kind: "tokenUrl",
        tokenUrl: stored.tokenUrl ?? "",
        clientId: stored.clientId ?? "",
        clientSecret: safeDecrypt(stored.clientSecretEnc ?? "", this.encryptionKey),
      };
    }
    return {
      kind: "basic",
      username: stored.username ?? "",
      password: safeDecrypt(stored.passwordEnc ?? "", this.encryptionKey),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function enabledFieldFor(surface: Surface): "enabledForPlayground" | "enabledForSkillGen" {
  return surface === "playground" ? "enabledForPlayground" : "enabledForSkillGen";
}

export function defaultFieldFor(surface: Surface): "defaultForPlayground" | "defaultForSkillGen" {
  return surface === "playground" ? "defaultForPlayground" : "defaultForSkillGen";
}

function safeDecrypt(blob: string, key: string): string {
  if (!blob) return "";
  try {
    return decryptSecret(blob, key);
  } catch (err) {
    logger.error(
      { err: (err as Error).message },
      "Failed to decrypt provider secret — treating as empty",
    );
    return "";
  }
}

function parse<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw zodToAppError(r.error);
  }
  return r.data;
}

function zodToAppError(err: ZodError): AppError {
  const first = err.issues[0];
  const path = first.path.join(".");
  const msg = path.length > 0 ? `${path}: ${first.message}` : first.message;
  return AppError.badRequest("invalid_provider_input", msg);
}
