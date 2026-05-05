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
import type { PlatformSettingsRepository } from "./repository";
import {
  DEFAULT_PLATFORM_SETTINGS,
  type GithubMirrorRepoConfig,
  type PlatformSettings,
} from "./types";

export interface PlatformSettingsDefaults {
  /** GitHub mirror coordinates from the configmap. Never empty in prod. */
  githubMirror: GithubMirrorRepoConfig;
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
    const settings: PlatformSettings = {
      auditWaiverThreshold:
        typeof stored.auditWaiverThreshold === "number"
          ? stored.auditWaiverThreshold
          : DEFAULT_PLATFORM_SETTINGS.auditWaiverThreshold,
      githubMirror: stored.githubMirror ?? this.defaults.githubMirror,
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

  async patch(partial: Partial<PlatformSettings>): Promise<PlatformSettings> {
    await this.repo.patch(partial);
    // Bust the cache so the next read pulls the fresh value through the
    // merge layer (which re-applies defaults for fields the admin
    // didn't set).
    this.cache = null;
    return this.get();
  }
}
