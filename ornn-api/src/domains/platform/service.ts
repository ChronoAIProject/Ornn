/**
 * PlatformSettingsService — thin in-memory cache on top of the
 * repository so hot code paths (the audit-gated permissions handler)
 * don't hit Mongo on every call.
 *
 * @module domains/platform/service
 */

import type { PlatformSettingsRepository } from "./repository";
import type { PlatformSettings } from "./types";

export class PlatformSettingsService {
  private readonly repo: PlatformSettingsRepository;
  /** 30s cache — settings change infrequently, stale is fine. */
  private readonly cacheTtlMs = 30_000;
  private cache: { settings: PlatformSettings; expiresAt: number } | null = null;

  constructor(repo: PlatformSettingsRepository) {
    this.repo = repo;
  }

  async get(): Promise<PlatformSettings> {
    const now = Date.now();
    if (this.cache && now < this.cache.expiresAt) return this.cache.settings;
    const settings = await this.repo.get();
    this.cache = { settings, expiresAt: now + this.cacheTtlMs };
    return settings;
  }

  async getAuditWaiverThreshold(): Promise<number> {
    return (await this.get()).auditWaiverThreshold;
  }

  async patch(partial: Partial<PlatformSettings>): Promise<PlatformSettings> {
    const updated = await this.repo.patch(partial);
    // Prime the cache with the fresh value so a subsequent read in the
    // same request path doesn't spend a round-trip.
    this.cache = { settings: updated, expiresAt: Date.now() + this.cacheTtlMs };
    return updated;
  }
}
