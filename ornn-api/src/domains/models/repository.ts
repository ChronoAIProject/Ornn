/**
 * Mongo persistence for the admin model catalog.
 *
 * One document per `modelId`. `_id` is the modelId itself so admin
 * upserts and execute-time lookups are O(1) primary-key reads.
 *
 * @module domains/models/repository
 */

import type { Collection, Db } from "mongodb";
import pino from "pino";
import type { ModelDocument } from "./types";

const logger = pino({ level: "info" }).child({ module: "modelsRepository" });

interface StoredModel extends Omit<ModelDocument, never> {
  _id: string;
}

export class ModelsRepository {
  private readonly collection: Collection<StoredModel>;

  constructor(db: Db) {
    this.collection = db.collection<StoredModel>("models");
  }

  async ensureIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ archived: 1, enabledForPlayground: 1 });
      await this.collection.createIndex({ archived: 1, enabledForSkillGen: 1 });
      await this.collection.createIndex({ defaultForPlayground: 1 });
      await this.collection.createIndex({ defaultForSkillGen: 1 });
    } catch (err) {
      logger.warn({ err }, "models indexes ensureIndexes failed — proceeding anyway");
    }
  }

  async findById(modelId: string): Promise<ModelDocument | null> {
    const doc = await this.collection.findOne({ _id: modelId });
    return doc ? toModel(doc) : null;
  }

  async listAll(includeArchived: boolean): Promise<ModelDocument[]> {
    const filter: Record<string, unknown> = {};
    if (!includeArchived) filter.archived = false;
    const docs = await this.collection
      .find(filter)
      .sort({ archived: 1, modelId: 1 })
      .toArray();
    return docs.map(toModel);
  }

  /** Hot path for the user picker — only enabled, non-archived rows. */
  async listEnabledForSurface(surface: "playground" | "skillGen"): Promise<ModelDocument[]> {
    const surfaceField =
      surface === "playground" ? "enabledForPlayground" : "enabledForSkillGen";
    const docs = await this.collection
      .find({ [surfaceField]: true, archived: false })
      .toArray();
    return docs.map(toModel);
  }

  /**
   * Sync upstream catalog. Performs:
   *  - Insert when a modelId is new — enabled flags default to false so
   *    admins explicitly opt in.
   *  - Update `displayName` and `lastSyncedAt` for existing rows; never
   *    flips enable / default flags during sync.
   *  - Mark `archived = true` for stored models absent from upstream.
   *  - Un-archive when an upstream model reappears (defaults still
   *    require admin re-enable).
   */
  async sync(
    upstream: Array<{ id: string; displayName: string }>,
    now: Date = new Date(),
  ): Promise<{ added: number; updated: number; archived: number; total: number }> {
    const upstreamIds = new Set(upstream.map((m) => m.id));

    let added = 0;
    let updated = 0;

    for (const m of upstream) {
      const existing = await this.collection.findOne({ _id: m.id });
      if (!existing) {
        const doc: StoredModel = {
          _id: m.id,
          modelId: m.id,
          displayName: m.displayName,
          enabledForPlayground: false,
          enabledForSkillGen: false,
          defaultForPlayground: false,
          defaultForSkillGen: false,
          archived: false,
          lastSyncedAt: now,
          createdAt: now,
        };
        await this.collection.insertOne(doc);
        added++;
      } else {
        await this.collection.updateOne(
          { _id: m.id },
          {
            $set: {
              displayName: m.displayName,
              archived: false,
              lastSyncedAt: now,
            },
          },
        );
        updated++;
      }
    }

    const archiveResult = await this.collection.updateMany(
      { _id: { $nin: Array.from(upstreamIds) } },
      { $set: { archived: true, lastSyncedAt: now } },
    );

    logger.info(
      { added, updated, archived: archiveResult.modifiedCount, total: upstream.length },
      "Models catalog sync complete",
    );

    return {
      added,
      updated,
      archived: archiveResult.modifiedCount,
      total: upstream.length,
    };
  }

  /**
   * Patch a single model's admin-controlled flags. When a `default*`
   * flag is set true, the prior default for the same surface is cleared
   * in the same update.
   */
  async patchFlags(
    modelId: string,
    updates: Partial<{
      enabledForPlayground: boolean;
      enabledForSkillGen: boolean;
      defaultForPlayground: boolean;
      defaultForSkillGen: boolean;
    }>,
  ): Promise<ModelDocument | null> {
    if (updates.defaultForPlayground === true) {
      await this.collection.updateMany(
        { defaultForPlayground: true, _id: { $ne: modelId } },
        { $set: { defaultForPlayground: false } },
      );
    }
    if (updates.defaultForSkillGen === true) {
      await this.collection.updateMany(
        { defaultForSkillGen: true, _id: { $ne: modelId } },
        { $set: { defaultForSkillGen: false } },
      );
    }
    const set: Record<string, unknown> = {};
    if (typeof updates.enabledForPlayground === "boolean")
      set.enabledForPlayground = updates.enabledForPlayground;
    if (typeof updates.enabledForSkillGen === "boolean")
      set.enabledForSkillGen = updates.enabledForSkillGen;
    if (typeof updates.defaultForPlayground === "boolean")
      set.defaultForPlayground = updates.defaultForPlayground;
    if (typeof updates.defaultForSkillGen === "boolean")
      set.defaultForSkillGen = updates.defaultForSkillGen;
    if (Object.keys(set).length === 0) return this.findById(modelId);
    const result = await this.collection.findOneAndUpdate(
      { _id: modelId },
      { $set: set },
      { returnDocument: "after" },
    );
    return result ? toModel(result) : null;
  }
}

function toModel(doc: StoredModel): ModelDocument {
  return {
    modelId: doc.modelId,
    displayName: doc.displayName,
    enabledForPlayground: doc.enabledForPlayground,
    enabledForSkillGen: doc.enabledForSkillGen,
    defaultForPlayground: doc.defaultForPlayground,
    defaultForSkillGen: doc.defaultForSkillGen,
    archived: doc.archived,
    lastSyncedAt: doc.lastSyncedAt,
    createdAt: doc.createdAt,
  };
}
