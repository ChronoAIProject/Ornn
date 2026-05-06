/**
 * PlatformSettingsService — thin in-memory cache on top of the
 * repository so hot code paths (the audit-gated permissions handler,
 * MirrorService's per-commit repo-coords lookup) don't hit Mongo on
 * every call.
 *
 * Decrypts at-rest secrets (LLM provider `apiKey`, GitHub App
 * `appPrivateKey`) at the service boundary on read; encrypts on write.
 * Every downstream consumer sees plaintext. Failures are non-fatal: an
 * unreadable secret degrades to "no value set" so the rest of the
 * system keeps working.
 *
 * @module domains/platform/service
 */
import pino from "pino";
import { decryptSecret, encryptSecret } from "../../infra/crypto";
import type { PlatformSettingsRepository } from "./repository";
import {
  DEFAULT_PLATFORM_SETTINGS,
  type GithubMirrorConfig,
  type LlmProviderConfig,
  type PlatformSettings,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "platformSettingsService" });

export interface PlatformSettingsDefaults {
  /**
   * Master passphrase used to encrypt/decrypt at-rest secrets (LLM
   * `apiKey`, GitHub App `appPrivateKey`). Sourced from `ENCRYPTION_KEY`
   * env. Required — the service never sees plaintext at the DB layer.
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

    const mirrorRaw = stored.githubMirror ?? DEFAULT_PLATFORM_SETTINGS.githubMirror;
    let appPrivateKey = "";
    try {
      appPrivateKey = decryptSecret(
        mirrorRaw.appPrivateKey ?? "",
        this.defaults.encryptionKey,
      );
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        "Failed to decrypt GitHub App private key — treating as unset",
      );
    }

    const settings: PlatformSettings = {
      auditWaiverThreshold:
        typeof stored.auditWaiverThreshold === "number"
          ? stored.auditWaiverThreshold
          : DEFAULT_PLATFORM_SETTINGS.auditWaiverThreshold,
      githubMirror: {
        enabled: typeof mirrorRaw.enabled === "boolean" ? mirrorRaw.enabled : false,
        owner: mirrorRaw.owner ?? "",
        repo: mirrorRaw.repo ?? "",
        branch: mirrorRaw.branch ?? "",
        appId: mirrorRaw.appId ?? "",
        installationId: mirrorRaw.installationId ?? "",
        appPrivateKey,
      },
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

  /** Full mirror config — kill switch + repo coords + App credentials. */
  async getGithubMirrorConfig(): Promise<GithubMirrorConfig> {
    return (await this.get()).githubMirror;
  }

  /** Convenience accessor used by `NyxLlmClient` on every LLM call. */
  async getLlmProviderConfig(): Promise<LlmProviderConfig> {
    return (await this.get()).llmProvider;
  }

  async patch(partial: Partial<PlatformSettings>): Promise<PlatformSettings> {
    // Encrypt sensitive fields before persisting. The patch layer sees
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
    if (partial.githubMirror) {
      const enc = encryptSecret(
        partial.githubMirror.appPrivateKey ?? "",
        this.defaults.encryptionKey,
      );
      toStore.githubMirror = {
        enabled: !!partial.githubMirror.enabled,
        owner: partial.githubMirror.owner ?? "",
        repo: partial.githubMirror.repo ?? "",
        branch: partial.githubMirror.branch ?? "",
        appId: partial.githubMirror.appId ?? "",
        installationId: partial.githubMirror.installationId ?? "",
        appPrivateKey: enc,
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
