/**
 * Singleton platform-settings document in Mongo. Single row keyed by a
 * fixed `_id`; absent row = defaults.
 *
 * @module domains/platform/repository
 */

import type { Collection, Db, Document } from "mongodb";
import { DEFAULT_PLATFORM_SETTINGS, type PlatformSettings } from "./types";

const SETTINGS_ID = "ornn";

export class PlatformSettingsRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("platform_settings");
  }

  async get(): Promise<PlatformSettings> {
    const doc = (await this.collection.findOne({
      _id: SETTINGS_ID as unknown as Document["_id"],
    })) as (Document & Partial<PlatformSettings>) | null;
    if (!doc) return { ...DEFAULT_PLATFORM_SETTINGS };
    return {
      auditWaiverThreshold:
        typeof doc.auditWaiverThreshold === "number"
          ? doc.auditWaiverThreshold
          : DEFAULT_PLATFORM_SETTINGS.auditWaiverThreshold,
    };
  }

  async patch(partial: Partial<PlatformSettings>): Promise<PlatformSettings> {
    await this.collection.updateOne(
      { _id: SETTINGS_ID as unknown as Document["_id"] },
      {
        $set: partial,
        $setOnInsert: { _id: SETTINGS_ID },
      },
      { upsert: true },
    );
    return this.get();
  }
}
