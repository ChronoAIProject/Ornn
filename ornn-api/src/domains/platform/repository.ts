/**
 * Singleton platform-settings document in Mongo. Single row keyed by a
 * fixed `_id`. Returns a `Partial<PlatformSettings>` so the service
 * layer can apply configmap-driven defaults — fields the admin has not
 * touched come back undefined, NOT pre-filled with sentinel defaults.
 *
 * @module domains/platform/repository
 */

import type { Collection, Db, Document } from "mongodb";
import type { LlmProviderConfig, PlatformSettings } from "./types";

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
    if (doc.llmProvider && typeof doc.llmProvider === "object") {
      const p = doc.llmProvider as Partial<LlmProviderConfig>;
      out.llmProvider = {
        gatewayUrl: typeof p.gatewayUrl === "string" ? p.gatewayUrl : "",
        apiKey: typeof p.apiKey === "string" ? p.apiKey : "",
      };
    }
    return out;
  }

  /**
   * Partial upsert. Pass only the fields you want to change; nothing
   * else is touched. `llmProvider` is written as a full object (atomic)
   * — the service layer assembles complete shapes (including encrypting
   * any sensitive fields) before calling here.
   */
  async patch(partial: Partial<PlatformSettings>): Promise<Partial<PlatformSettings>> {
    const set: Record<string, unknown> = {};
    if (typeof partial.auditWaiverThreshold === "number") {
      set.auditWaiverThreshold = partial.auditWaiverThreshold;
    }
    if (partial.llmProvider) {
      set.llmProvider = {
        gatewayUrl: partial.llmProvider.gatewayUrl ?? "",
        apiKey: partial.llmProvider.apiKey ?? "",
      } satisfies LlmProviderConfig;
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
