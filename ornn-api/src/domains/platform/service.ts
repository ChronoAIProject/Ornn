/**
 * PlatformSettingsService — thin in-memory cache on top of the
 * repository so hot code paths (the audit-gated permissions handler,
 * MirrorService's per-commit repo-coords lookup) don't hit Mongo on
 * every call.
 *
 * Layers a configmap-driven default set under whatever the DB stores,
 * so a fresh deployment with no admin-set DB row falls back to what
 * the configmap says. Once an admin patches via PATCH /admin/settings
 * (or POST /api/v1/github/repo for the mirror block), the DB value
 * wins thereafter.
 *
 * @module domains/platform/service
 */
import pino from "pino";
import { decryptSecret, encryptSecret } from "../../infra/crypto";
import type { PlatformSettingsRepository } from "./repository";
import {
  DEFAULT_PLATFORM_SETTINGS,
  type GithubMirrorRepoConfig,
  type LlmProviderConfig,
  type PlatformSettings,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "platformSettingsService" });

export interface PlatformSettingsDefaults {
  /** GitHub mirror coordinates from the configmap. Never empty in prod. */
  githubMirror: GithubMirrorRepoConfig;
  /**
   * Master passphrase used to encrypt/decrypt at-rest secrets (LLM
   * `apiKey`, etc.). Sourced from `ENCRYPTION_KEY` env. Required —
   * the service never sees plaintext at the DB layer.
   */
  encryptionKey: string;
}

export class PlatformSettingsService {
  private readonly repo: PlatformSettingsRepository;
  private readonly defaults: PlatformSettingsDefaults;
  /** 30s cache — settings change infrequently, stale is fine. */
  private readonly cacheTtlMs = 30_000;
  private cache: { settings: PlatformSettings; expiresAt: number } | null = null;

  constructor(repo: PlatformSettingsRepository, defaults: PlatformSettingsDefaults) {
    this.repo = repo;
    this.defaults = defaults;
  }

  async get(): Promise<PlatformSettings> {
    const now = Date.now();
    if (this.cache && now < this.cache.expiresAt) return this.cache.settings;
    const stored = await this.repo.get();
    // Decrypt the LLM provider apiKey at the service boundary — every
    // downstream consumer sees plaintext. Failures are non-fatal: an
    // unreadable secret degrades to "no apiKey set" so the rest of the
    // system (including the admin UI) keeps working.
    const llmRaw = stored.llmProvider ?? DEFAULT_PLATFORM_SETTINGS.llmProvider;
    let llmApiKey = "";
    try {
      llmApiKey = decryptSecret(llmRaw.apiKey ?? "", this.defaults.encryptionKey);
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        "Failed to decrypt LLM provider apiKey — treating as unset",
      );
    }
    const settings: PlatformSettings = {
      auditWaiverThreshold:
        typeof stored.auditWaiverThreshold === "number"
          ? stored.auditWaiverThreshold
          : DEFAULT_PLATFORM_SETTINGS.auditWaiverThreshold,
      githubMirror: stored.githubMirror ?? this.defaults.githubMirror,
      llmProvider: {
        gatewayUrl: llmRaw.gatewayUrl ?? "",
        apiKey: llmApiKey,
      },
    };
    this.cache = { settings, expiresAt: now + this.cacheTtlMs };
    return settings;
  }

  async getAuditWaiverThreshold(): Promise<number> {
    return (await this.get()).auditWaiverThreshold;
  }

  /** Convenience accessor used by `MirrorService` and the new `/github/repo` route. */
  async getGithubMirrorRepo(): Promise<GithubMirrorRepoConfig> {
    return (await this.get()).githubMirror;
  }

  /** Convenience accessor used by `NyxLlmClient` on every LLM call. */
  async getLlmProviderConfig(): Promise<LlmProviderConfig> {
    return (await this.get()).llmProvider;
  }

  async patch(partial: Partial<PlatformSettings>): Promise<PlatformSettings> {
    // Encrypt the LLM apiKey before persisting. The patch layer sees
    // plaintext from the route; the repo only ever stores ciphertext.
    type MutablePatch = { -readonly [K in keyof PlatformSettings]?: PlatformSettings[K] };
    const toStore: MutablePatch = { ...partial };
    if (partial.llmProvider) {
      const enc = encryptSecret(
        partial.llmProvider.apiKey ?? "",
        this.defaults.encryptionKey,
      );
      toStore.llmProvider = {
        gatewayUrl: partial.llmProvider.gatewayUrl ?? "",
        apiKey: enc,
      };
    }
    await this.repo.patch(toStore);
    // Bust the cache so the next read pulls the fresh value through the
    // merge layer (which re-applies defaults for fields the admin
    // didn't set).
    this.cache = null;
    return this.get();
  }
}
