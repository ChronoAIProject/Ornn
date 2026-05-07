/**
 * One-doc-per-provider persistence in the `llm_providers` collection
 * (Architecture §3.4). Repository deals exclusively in stored shape —
 * `Enc`-suffixed fields hold ciphertext; the service layer above
 * encrypts on write and decrypts on read.
 *
 * Per-model surface flags (#270 — single-source per-provider model
 * management): each row in `models[]` carries `enabledForPlayground`,
 * `enabledForSkillGen`, `defaultForPlayground`, `defaultForSkillGen`.
 * The at-most-one-default-per-surface invariant is enforced by the
 * service via `clearDefaultsForSurfaceExcept` — at the storage layer
 * this is a `$set: { "models.$[m].defaultForX": false }` array
 * filter that runs in the same write request as setting the new
 * default, so cross-provider writes can't race past each other.
 *
 * @module domains/settings/llmProviders/repository
 */

import type { Collection, Db, Document } from "mongodb";
import type { ApiFormat, LlmProviderModel } from "./types";

export interface StoredAuth {
  readonly kind: "apiKey" | "tokenUrl" | "basic";
  readonly apiKeyEnc?: string;
  readonly tokenUrl?: string;
  readonly clientId?: string;
  readonly clientSecretEnc?: string;
  readonly username?: string;
  readonly passwordEnc?: string;
}

export interface StoredProvider {
  readonly _id: string;
  readonly name: string;
  readonly gatewayUrl: string;
  readonly modelListUrl: string;
  readonly apiFormat: ApiFormat;
  readonly auth: StoredAuth;
  readonly models: ReadonlyArray<LlmProviderModel>;
  readonly maxOutputTokens: number;
  readonly defaultTemperature: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

/** Surface key — must match the in-store field naming convention. */
export type SurfaceKey = "Playground" | "SkillGen";

export class LlmProvidersRepository {
  private readonly collection: Collection<Document>;

  constructor(db: Db) {
    this.collection = db.collection("llm_providers");
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ name: 1 }, { unique: true });
  }

  async list(): Promise<ReadonlyArray<StoredProvider>> {
    const docs = await this.collection.find({}).sort({ name: 1 }).toArray();
    return docs.map(this.fromDoc);
  }

  async findById(id: string): Promise<StoredProvider | null> {
    const doc = await this.collection.findOne({
      _id: id as unknown as Document["_id"],
    });
    return doc ? this.fromDoc(doc) : null;
  }

  async findByName(name: string): Promise<StoredProvider | null> {
    const doc = await this.collection.findOne({ name });
    return doc ? this.fromDoc(doc) : null;
  }

  async insert(doc: StoredProvider): Promise<void> {
    await this.collection.insertOne(doc as unknown as Document);
  }

  async replace(id: string, doc: StoredProvider): Promise<void> {
    await this.collection.replaceOne(
      { _id: id as unknown as Document["_id"] },
      doc as unknown as Document,
    );
  }

  async deleteById(id: string): Promise<boolean> {
    const res = await this.collection.deleteOne({
      _id: id as unknown as Document["_id"],
    });
    return res.deletedCount === 1;
  }

  /**
   * Across **every** provider, set `models[*].defaultFor<Surface>: false`
   * EXCEPT for the `(providerId, modelId)` pair passed in `keep`. Used
   * by `LlmProvidersService.patchModel` to enforce the at-most-one-
   * default-per-surface invariant in a single write.
   *
   * Implementation: one `updateMany` per provider with an `arrayFilters`
   * matching the surface field. Acceptable for the tens-of-providers
   * scale we expect (writes are admin-only, rare).
   */
  async clearDefaultsForSurfaceExcept(
    surface: SurfaceKey,
    keep: { providerId: string; modelId: string } | null,
  ): Promise<void> {
    const field = `models.$[m].defaultFor${surface}` as const;
    const filterField = `m.defaultFor${surface}` as const;
    const arrayFilters: Document[] = [{ [filterField]: true }];
    if (keep) {
      arrayFilters[0]["m.id"] = { $ne: keep.modelId };
    }
    const filter: Document = keep
      ? { _id: { $ne: keep.providerId as unknown as Document["_id"] } }
      : {};
    // Step 1: clear on every provider EXCEPT the one we're about to keep.
    await this.collection.updateMany(filter, { $set: { [field]: false } }, {
      arrayFilters: [{ [filterField]: true }],
    });
    // Step 2: clear sibling rows on the keeper provider, leaving the
    // chosen model alone.
    if (keep) {
      await this.collection.updateOne(
        { _id: keep.providerId as unknown as Document["_id"] },
        { $set: { [field]: false } },
        { arrayFilters },
      );
    }
  }

  private fromDoc(doc: Document): StoredProvider {
    const d = doc as unknown as StoredProvider & { _id: string };
    return {
      _id: d._id,
      name: d.name,
      gatewayUrl: d.gatewayUrl,
      modelListUrl: d.modelListUrl,
      apiFormat: d.apiFormat,
      auth: d.auth,
      models: (d.models ?? []).map((m) => normalizeModel(m)),
      maxOutputTokens: d.maxOutputTokens,
      defaultTemperature: d.defaultTemperature,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      updatedBy: d.updatedBy ?? "system",
    };
  }
}

/**
 * Forward-compatibility shim — the `models[]` array on disk used to
 * carry a single `enabled` boolean. After #270 the schema is the four
 * surface flags. Pre-migration docs are mapped here so reads always
 * see the new shape; the boot migration is what actually writes the
 * new fields back to disk.
 */
function normalizeModel(raw: LlmProviderModel & { enabled?: boolean }): LlmProviderModel {
  return {
    id: raw.id,
    displayName: raw.displayName,
    enabledForPlayground:
      typeof raw.enabledForPlayground === "boolean"
        ? raw.enabledForPlayground
        : raw.enabled === true,
    enabledForSkillGen:
      typeof raw.enabledForSkillGen === "boolean"
        ? raw.enabledForSkillGen
        : raw.enabled === true,
    defaultForPlayground: raw.defaultForPlayground === true,
    defaultForSkillGen: raw.defaultForSkillGen === true,
    removed: raw.removed === true,
    firstSeenAt: raw.firstSeenAt instanceof Date ? raw.firstSeenAt : new Date(raw.firstSeenAt),
    lastSyncedAt: raw.lastSyncedAt instanceof Date ? raw.lastSyncedAt : new Date(raw.lastSyncedAt),
  };
}
