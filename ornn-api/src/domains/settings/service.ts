/**
 * SettingsServiceImpl — read-through cache (TTL=30s, in-process) over
 * `platform_settings` per-section docs and `llm_providers` provider docs.
 *
 * Responsibilities:
 *   • Decrypt secret fields on read (apiKey / clientSecret / password /
 *     appPrivateKey / postHogApiKey) so internal callers see plaintext.
 *   • Encrypt secret fields on write before they hit Mongo.
 *   • Run the section's Zod schema before persisting (caller may also
 *     validate, but the service is the last line of defence).
 *   • Bust the cache on every successful write so reads after PUT see
 *     the new value within the TTL window.
 *   • Fail-safe on decrypt errors: log + return the section default's
 *     secret value (empty string) so a corrupted ciphertext doesn't
 *     crash every downstream caller.
 *
 * Clock is injected for test determinism (TTL expiry tests).
 *
 * @module domains/settings/service
 */

import pino from "pino";
import { ZodError } from "zod";
import {
  decryptSecret,
  encryptSecret,
  isPreserveSentinel,
} from "../../infra/crypto";
import { AppError } from "../../shared/types/index";
import type { LlmProvider } from "./llmProviders/types";
import type { SettingsRepository } from "./repository";
import {
  sections,
  type ExtrasSection,
  type MirrorSection,
  type NyxidSection,
  type PlaygroundSection,
  type SectionId,
  type SkillAuditSection,
  type SkillGenSection,
  type TelemetrySection,
} from "./sections";
import type {
  PutSectionResult,
  SettingsActor,
  SettingsService,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "settingsService" });

export interface SettingsServiceDeps {
  readonly repo: SettingsRepository;
  readonly encryptionKey: string;
  /** Optional: provider service used by `listLlmProviders` / `getLlmProvider`. Wired post-construction. */
  llmProviders?: {
    list(): Promise<ReadonlyArray<LlmProvider>>;
    get(id: string): Promise<LlmProvider | null>;
  };
  /** Cache TTL in milliseconds. Defaults to 30s; tests override to 0 for cache-bypass. */
  readonly cacheTtlMs?: number;
  /** Injectable clock — defaults to `Date.now`. */
  readonly clock?: () => number;
}

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export class SettingsServiceImpl implements SettingsService {
  private readonly repo: SettingsRepository;
  private readonly encryptionKey: string;
  private readonly cacheTtlMs: number;
  private readonly clock: () => number;
  private llmProviders: SettingsServiceDeps["llmProviders"];
  private cache: Map<SectionId, CacheEntry<unknown>> = new Map();

  constructor(deps: SettingsServiceDeps) {
    this.repo = deps.repo;
    this.encryptionKey = deps.encryptionKey;
    this.cacheTtlMs = deps.cacheTtlMs ?? 30_000;
    this.clock = deps.clock ?? (() => Date.now());
    this.llmProviders = deps.llmProviders;
  }

  /** Late-binding: the LLM provider service is wired after construction. */
  setLlmProvidersAccessor(accessor: SettingsServiceDeps["llmProviders"]): void {
    this.llmProviders = accessor;
  }

  // -------------------------------------------------------------------
  // Per-section accessors
  // -------------------------------------------------------------------

  async getPlayground(): Promise<PlaygroundSection> {
    return this.getSection<PlaygroundSection>("playground");
  }
  async getSkillGen(): Promise<SkillGenSection> {
    return this.getSection<SkillGenSection>("skillGen");
  }
  async getMirror(): Promise<MirrorSection> {
    return this.getSection<MirrorSection>("mirror");
  }
  async getNyxid(): Promise<NyxidSection> {
    return this.getSection<NyxidSection>("nyxid");
  }
  async getSkillAudit(): Promise<SkillAuditSection> {
    return this.getSection<SkillAuditSection>("skillAudit");
  }
  async getTelemetry(): Promise<TelemetrySection> {
    return this.getSection<TelemetrySection>("telemetry");
  }
  async getExtras(): Promise<ExtrasSection> {
    return this.getSection<ExtrasSection>("extras");
  }

  async getSection<T>(id: SectionId): Promise<T> {
    const cached = this.cache.get(id);
    const now = this.clock();
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }
    const value = await this.loadSection<T>(id);
    this.cache.set(id, { value, expiresAt: now + this.cacheTtlMs });
    return value;
  }

  private async loadSection<T>(id: SectionId): Promise<T> {
    const meta = sections[id];
    const stored = await this.repo.getSection(id);
    const raw = stored?.value ?? meta.defaults;
    // Decrypt secret fields — best-effort. A bad ciphertext degrades to
    // empty so the rest of the system keeps working; we log loudly.
    const decrypted = this.decryptSecrets(raw, meta.secretFields);
    // Merge defaults so any field the operator hasn't set gets a safe
    // value. Critical for a fresh deployment where the section row is
    // entirely absent.
    const merged = { ...meta.defaults, ...(decrypted as object) } as T;
    return merged;
  }

  async putSection<T>(
    id: SectionId,
    value: T,
    actor: SettingsActor,
  ): Promise<PutSectionResult<T>> {
    const meta = sections[id];

    // Sentinel-resolve any secret field (REDACTED / mid-mask) → keep DB.
    const inputObj = value as unknown as Record<string, unknown>;
    const resolved: Record<string, unknown> = { ...inputObj };
    if (meta.secretFields.length > 0) {
      const previous = await this.loadSection<Record<string, unknown>>(id);
      for (const field of meta.secretFields) {
        const incoming = inputObj[field];
        if (typeof incoming === "string" && isPreserveSentinel(incoming)) {
          resolved[field] = previous[field] ?? "";
        }
      }
    }

    // Validate. We use safeParse so we can surface field-level issues
    // to the route handler for a clean 400 response.
    const parsed = meta.schema.safeParse(resolved);
    if (!parsed.success) {
      throw zodToAppError(parsed.error);
    }

    const validated = parsed.data as Record<string, unknown>;

    // Encrypt secret fields before persisting.
    const toStore: Record<string, unknown> = { ...validated };
    for (const field of meta.secretFields) {
      const plain = validated[field];
      if (typeof plain === "string" && plain.length > 0) {
        toStore[field] = encryptSecret(plain, this.encryptionKey);
      } else {
        toStore[field] = "";
      }
    }

    // Compute changed-fields list (non-secret only — never echo back
    // secret diffs even by name; we still record names but not values).
    const previousForDiff = await this.loadSection<Record<string, unknown>>(id);
    const changedFields: string[] = [];
    for (const key of Object.keys(validated)) {
      if (!shallowEqual(previousForDiff[key], validated[key])) {
        changedFields.push(key);
      }
    }

    await this.repo.putSection(id, toStore, actor.userId);

    // Bust this section's cache so the next read picks up the write.
    this.cache.delete(id);

    return {
      value: validated as T,
      changedFields,
    };
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  // -------------------------------------------------------------------
  // LLM providers
  // -------------------------------------------------------------------

  async listLlmProviders(): Promise<ReadonlyArray<LlmProvider>> {
    if (!this.llmProviders) return [];
    return this.llmProviders.list();
  }

  async getLlmProvider(id: string): Promise<LlmProvider | null> {
    if (!this.llmProviders) return null;
    return this.llmProviders.get(id);
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private decryptSecrets(
    raw: unknown,
    secretFields: ReadonlyArray<string>,
  ): unknown {
    if (secretFields.length === 0) return raw;
    if (typeof raw !== "object" || raw === null) return raw;
    const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    for (const field of secretFields) {
      const ct = out[field];
      if (typeof ct !== "string" || ct.length === 0) {
        out[field] = "";
        continue;
      }
      try {
        out[field] = decryptSecret(ct, this.encryptionKey);
      } catch (err) {
        logger.error(
          { err: (err as Error).message, field },
          "Failed to decrypt secret — falling back to empty",
        );
        out[field] = "";
      }
    }
    return out;
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  // For objects/arrays, compare JSON form. Cheap and good enough for
  // change-detection on small section payloads.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function zodToAppError(err: ZodError): AppError {
  const first = err.issues[0];
  const path = first.path.join(".");
  const msg = path.length > 0 ? `${path}: ${first.message}` : first.message;
  return AppError.badRequest("invalid_setting", msg);
}
