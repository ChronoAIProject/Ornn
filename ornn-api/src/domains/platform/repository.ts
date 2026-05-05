/**
 * Singleton platform-settings document in Mongo. Single row keyed by a
 * fixed `_id`. Returns a `Partial<PlatformSettings>` so the service
 * layer can apply configmap-driven defaults — fields the admin has not
 * touched come back undefined, NOT pre-filled with sentinel defaults.
 *
 * @module domains/platform/repository
 */

import type { Collection, Db, Document } from "mongodb";
import type { GithubMirrorRepoConfig, PlatformSettings } from "./types";

const SETTINGS_ID = "ornn";

export class PlatformSettingsRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("platform_settings");
  }

  /**
   * Returns the raw stored fields. Anything the admin hasn't touched is
   * `undefined`. The service layer is responsible for merging with
   * configmap-derived defaults.
   */
  async get(): Promise<Partial<PlatformSettings>> {
    const doc = (await this.collection.findOne({
      _id: SETTINGS_ID as unknown as Document["_id"],
    })) as (Document & Partial<PlatformSettings>) | null;
    if (!doc) return {};
    const out: { -readonly [K in keyof PlatformSettings]?: PlatformSettings[K] } = {};
    if (typeof doc.auditWaiverThreshold === "number") {
      out.auditWaiverThreshold = doc.auditWaiverThreshold;
    }
    if (
      doc.githubMirror &&
      typeof doc.githubMirror.owner === "string" &&
      typeof doc.githubMirror.repo === "string" &&
      typeof doc.githubMirror.branch === "string"
    ) {
      out.githubMirror = {
        owner: doc.githubMirror.owner,
        repo: doc.githubMirror.repo,
        branch: doc.githubMirror.branch,
      };
    }
    return out;
  }

  /**
   * Partial upsert. Pass only the fields you want to change; nothing
   * else is touched. `githubMirror` is always written as a full object
   * (atomic owner+repo+branch swap) — the route layer enforces that.
   */
  async patch(partial: Partial<PlatformSettings>): Promise<Partial<PlatformSettings>> {
    const set: Record<string, unknown> = {};
    if (typeof partial.auditWaiverThreshold === "number") {
      set.auditWaiverThreshold = partial.auditWaiverThreshold;
    }
    if (partial.githubMirror) {
      set.githubMirror = {
        owner: partial.githubMirror.owner,
        repo: partial.githubMirror.repo,
        branch: partial.githubMirror.branch,
      } satisfies GithubMirrorRepoConfig;
    }
    if (Object.keys(set).length === 0) return this.get();
    await this.collection.updateOne(
      { _id: SETTINGS_ID as unknown as Document["_id"] },
      {
        $set: set,
        $setOnInsert: { _id: SETTINGS_ID },
      },
      { upsert: true },
    );
    return this.get();
  }
}
