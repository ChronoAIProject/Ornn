/**
 * Per-section persistence for the settings umbrella. Each section is its
 * own document in the `platform_settings` collection, keyed by section id.
 *
 * Repository deals exclusively in raw stored shape — no crypto, no
 * defaults, no schema validation. Service layer above does that.
 *
 * @module domains/settings/repository
 */

import type { Collection, Db, Document } from "mongodb";

export interface StoredSection {
  /** Section id, also `_id`. */
  readonly _id: string;
  /** The actual payload — opaque to the repo, schema-validated upstream. */
  readonly value: unknown;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

export class SettingsRepository {
  private readonly collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection("platform_settings");
  }

  async getSection(id: string): Promise<StoredSection | null> {
    const doc = await this.collection.findOne({
      _id: id as unknown as Document["_id"],
    });
    if (!doc) return null;
    return {
      _id: id,
      value: (doc as { value?: unknown }).value ?? null,
      updatedAt: (doc as { updatedAt?: Date }).updatedAt ?? new Date(0),
      updatedBy: (doc as { updatedBy?: string }).updatedBy ?? "system",
    };
  }

  async listSections(): Promise<ReadonlyArray<StoredSection>> {
    const docs = await this.collection.find({}).toArray();
    return docs.map((d) => ({
      _id: d._id as unknown as string,
      value: (d as { value?: unknown }).value ?? null,
      updatedAt: (d as { updatedAt?: Date }).updatedAt ?? new Date(0),
      updatedBy: (d as { updatedBy?: string }).updatedBy ?? "system",
    }));
  }

  async putSection(
    id: string,
    value: unknown,
    actor: string,
    now: Date = new Date(),
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: id as unknown as Document["_id"] },
      {
        $set: { value, updatedAt: now, updatedBy: actor },
        $setOnInsert: { _id: id, createdAt: now },
      },
      { upsert: true },
    );
  }
}
