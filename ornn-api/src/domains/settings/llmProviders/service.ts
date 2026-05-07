/**
 * LlmProvidersService — CRUD over the `llm_providers` collection plus
 * the model-list sync routine (Story 7.1).
 *
 * Sync semantics (Architecture §5.3):
 *   • Existing models keep their `enabled` flag; their `lastSyncedAt`
 *     is bumped.
 *   • Models in the upstream catalog that the service has never seen
 *     before arrive with `enabled: false`, `removed: false`,
 *     `firstSeenAt = now`.
 *   • Models the service knows about that are NO LONGER in the upstream
 *     catalog get `removed: true` but are kept for history.
 *   • A model whose `removed:true` row reappears upstream flips back to
 *     `removed:false`, preserving its prior `enabled` flag.
 *
 * Sync is idempotent: re-running with the same upstream list yields
 * `{ added:0, updated:0, removed:0 }`.
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
import type { LlmProvidersRepository, StoredAuth, StoredProvider } from "./repository";
import type {
  ApiFormat,
  LlmProvider,
  LlmProviderAuth,
  LlmProviderModel,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "llmProvidersService" });

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

const modelInputSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean(),
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
  defaultModelId: z.string().nullable().default(null),
  maxOutputTokens: z.number().int().min(1).max(1_000_000),
  defaultTemperature: z.number().min(0).max(2),
});

export type ProviderCreateInput = z.infer<typeof providerCreateSchema>;

export const providerUpdateSchema = providerCreateSchema.partial();
export type ProviderUpdateInput = z.infer<typeof providerUpdateSchema>;

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

  // -------- read paths --------

  async list(): Promise<ReadonlyArray<LlmProvider>> {
    const stored = await this.repo.list();
    return stored.map((s) => this.toProvider(s));
  }

  async get(id: string): Promise<LlmProvider | null> {
    const stored = await this.repo.findById(id);
    return stored ? this.toProvider(stored) : null;
  }

  /**
   * Same as `list()` but mid-masks every secret field. Used directly by
   * admin GET routes so the response never carries plaintext.
   */
  async listForAdmin(): Promise<ReadonlyArray<LlmProvider>> {
    return (await this.list()).map((p) => this.maskAuth(p));
  }
  async getForAdmin(id: string): Promise<LlmProvider | null> {
    const p = await this.get(id);
    return p ? this.maskAuth(p) : null;
  }

  // -------- write paths --------

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
    this.validateDefaultModel(parsed.defaultModelId, parsed.models);

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
        enabled: m.enabled,
        removed: m.removed ?? false,
        firstSeenAt: now,
        lastSyncedAt: now,
      })),
      defaultModelId: parsed.defaultModelId,
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
      throw AppError.notFound("PROVIDER_NOT_FOUND", `No provider ${id}`);
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
          enabled: m.enabled,
          removed: m.removed ?? prev?.removed ?? false,
          firstSeenAt: prev?.firstSeenAt ?? now,
          lastSyncedAt: prev?.lastSyncedAt ?? now,
        };
      });
    }

    const defaultModelId =
      patch.defaultModelId === undefined
        ? existing.defaultModelId
        : patch.defaultModelId;
    this.validateDefaultModel(defaultModelId, models);

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
      defaultModelId,
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

  // -------- sync --------

  async sync(id: string, actor: SettingsActor): Promise<{
    provider: LlmProvider;
    result: ProviderSyncResult;
  }> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw AppError.notFound("PROVIDER_NOT_FOUND", `No provider ${id}`);
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
          enabled: false,
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
        enabled: prev.enabled,
        removed: false,
        firstSeenAt: prev.firstSeenAt,
        lastSyncedAt: now,
      });
    }
    // Keep history rows for models no longer in upstream — flag removed.
    for (const prev of existing.models) {
      if (upstreamIds.has(prev.id)) continue;
      const wasRemoved = prev.removed;
      merged.push({
        ...prev,
        removed: true,
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

  // -------- helpers --------

  private toProvider(stored: StoredProvider): LlmProvider {
    return {
      _id: stored._id,
      name: stored.name,
      gatewayUrl: stored.gatewayUrl,
      modelListUrl: stored.modelListUrl,
      apiFormat: stored.apiFormat,
      auth: this.decryptAuth(stored.auth),
      models: stored.models,
      defaultModelId: stored.defaultModelId,
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

  private validateDefaultModel(
    defaultModelId: string | null,
    models: ReadonlyArray<{ id: string; enabled: boolean; removed?: boolean }>,
  ): void {
    if (!defaultModelId) return;
    const m = models.find((x) => x.id === defaultModelId);
    if (!m) {
      throw AppError.badRequest(
        "INVALID_DEFAULT_MODEL",
        `defaultModelId "${defaultModelId}" is not in models[]`,
      );
    }
    if (!m.enabled) {
      throw AppError.badRequest(
        "INVALID_DEFAULT_MODEL",
        `defaultModelId "${defaultModelId}" is not enabled`,
      );
    }
    if (m.removed) {
      throw AppError.badRequest(
        "INVALID_DEFAULT_MODEL",
        `defaultModelId "${defaultModelId}" is marked removed`,
      );
    }
  }
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
  return AppError.badRequest("INVALID_PROVIDER_INPUT", msg);
}
