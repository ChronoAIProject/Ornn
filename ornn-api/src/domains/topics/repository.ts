/**
 * MongoDB-backed repositories for topics.
 *
 * `TopicRepository` owns the `topics` collection — topic identity, metadata,
 * and scope-aware read queries.
 *
 * `TopicSkillRepository` owns the `topic_skills` edge collection — membership
 * between topics and skills. The edge `_id` is `${topicGuid}:${skillGuid}`
 * which gives us natural uniqueness without a separate compound-unique
 * index. Compound indexes on both `(topicGuid, addedOn desc)` and
 * `(skillGuid, topicGuid)` keep listings-by-topic and listings-by-skill both
 * fast.
 *
 * @module domains/topics/repository
 */

import type { Collection, Db, Document } from "mongodb";
import type { TopicDocument, TopicSkillDocument } from "../../shared/types/index";
import { AppError } from "../../shared/types/index";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "topicsRepository" });

export interface CreateTopicData {
  guid: string;
  name: string;
  description: string;
  /**
   * Owner entity. For personal topics == `createdBy`. For org-owned topics this
   * is the org's NyxID user_id. Visibility + write rules both pivot on it.
   */
  ownerId: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  isPrivate?: boolean;
}

export interface UpdateTopicData {
  description?: string;
  isPrivate?: boolean;
  updatedBy: string;
  // ownerId is intentionally NOT settable: ownership is immutable after create.
}

export interface TopicFilters {
  query?: string;
  scope: "public" | "mine" | "mixed";
  currentUserId: string;
  /** User's admin/member org user_ids. Used for `mine` + `mixed` ownership matching. */
  userOrgIds: string[];
  page: number;
  pageSize: number;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyScope(
  matchStage: Record<string, unknown>,
  scope: "public" | "mine" | "mixed",
  currentUserId: string,
  userOrgIds: string[],
): void {
  const ownerIds = [currentUserId, ...userOrgIds];
  if (scope === "public") {
    matchStage.isPrivate = false;
  } else if (scope === "mine") {
    // "Mine" now means "topics owned by me OR by an org I'm in". Mirrors the
    // scope semantics we use for skills.
    matchStage.ownerId = { $in: ownerIds };
  } else if (scope === "mixed") {
    matchStage.$or = [{ isPrivate: false }, { ownerId: { $in: ownerIds } }];
  }
}

export class TopicRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("topics");
  }

  /** Idempotent. Call once on startup. */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ name: 1 }, { name: "topics_name_unique", unique: true });
    await this.collection.createIndex({ createdBy: 1 }, { name: "topics_created_by" });
  }

  async create(data: CreateTopicData): Promise<TopicDocument> {
    const now = new Date();
    const doc: Record<string, unknown> = {
      _id: data.guid as unknown as Document["_id"],
      name: data.name,
      description: data.description,
      ownerId: data.ownerId,
      createdBy: data.createdBy,
      createdByEmail: data.createdByEmail ?? null,
      createdByDisplayName: data.createdByDisplayName ?? null,
      createdOn: now,
      updatedBy: data.createdBy,
      updatedOn: now,
      isPrivate: data.isPrivate ?? false,
    };

    try {
      await this.collection.insertOne(doc as never);
      logger.info({ guid: data.guid, name: data.name }, "Topic created");
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        throw AppError.conflict("TOPIC_NAME_EXISTS", `Topic '${data.name}' already exists`);
      }
      throw err;
    }

    return mapDoc(doc)!;
  }

  async findByGuid(guid: string): Promise<TopicDocument | null> {
    const doc = await this.collection.findOne({ _id: guid as never });
    return mapDoc(doc);
  }

  async findByName(name: string): Promise<TopicDocument | null> {
    const doc = await this.collection.findOne({ name });
    return mapDoc(doc);
  }

  async update(guid: string, data: UpdateTopicData): Promise<TopicDocument> {
    const setFields: Record<string, unknown> = {
      updatedBy: data.updatedBy,
      updatedOn: new Date(),
    };
    if (data.description !== undefined) setFields.description = data.description;
    if (data.isPrivate !== undefined) setFields.isPrivate = data.isPrivate;

    await this.collection.updateOne({ _id: guid as never }, { $set: setFields });
    logger.info({ guid }, "Topic updated");
    return (await this.findByGuid(guid))!;
  }

  async hardDelete(guid: string): Promise<void> {
    await this.collection.deleteOne({ _id: guid as never });
    logger.info({ guid }, "Topic hard-deleted");
  }

  /**
   * List topics matching scope + optional keyword, paginated, newest-first.
   * `total` counts all matching topics (across pages).
   */
  async list(filters: TopicFilters): Promise<{ topics: TopicDocument[]; total: number }> {
    const { query, scope, currentUserId, userOrgIds, page, pageSize } = filters;
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId, userOrgIds);

    if (query && query.trim() !== "") {
      matchStage.$and = [
        matchStage.$or ? { $or: matchStage.$or } : {},
        {
          $or: [
            { _id: query },
            { name: { $regex: escapeRegex(query), $options: "i" } },
            { description: { $regex: escapeRegex(query), $options: "i" } },
          ],
        },
      ];
      // $or at the top level is superseded by $and when a query is present.
      delete matchStage.$or;
    }

    const total = await this.collection.countDocuments(matchStage);
    const offset = (page - 1) * pageSize;
    const docs = await this.collection
      .find(matchStage)
      .sort({ createdOn: -1 })
      .skip(offset)
      .limit(pageSize)
      .toArray();

    return { topics: docs.map((d) => mapDoc(d)!), total };
  }
}

function mapDoc(doc: Document | null): TopicDocument | null {
  if (!doc) return null;
  return {
    guid: doc._id as string,
    name: doc.name,
    description: doc.description ?? "",
    // Legacy documents may have been written before `ownerId` existed — fall
    // back to `createdBy` so reads stay consistent pre- and post-migration.
    ownerId: doc.ownerId ?? doc.createdBy ?? "",
    createdBy: doc.createdBy ?? "",
    createdByEmail: doc.createdByEmail ?? undefined,
    createdByDisplayName: doc.createdByDisplayName ?? undefined,
    createdOn: doc.createdOn ?? new Date(),
    updatedBy: doc.updatedBy ?? doc.createdBy ?? "",
    updatedOn: doc.updatedOn ?? doc.createdOn ?? new Date(),
    isPrivate: doc.isPrivate ?? false,
  };
}

// ---------------------------------------------------------------------------
// topic_skills — membership edges
// ---------------------------------------------------------------------------

export interface AddTopicSkillData {
  topicGuid: string;
  skillGuid: string;
  addedBy: string;
}

export class TopicSkillRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("topic_skills");
  }

  async ensureIndexes(): Promise<void> {
    // Fast listing of skills in a topic, newest-first.
    await this.collection.createIndex(
      { topicGuid: 1, addedOn: -1 },
      { name: "topic_skills_by_topic" },
    );
    // Fast lookup of topics a skill is in.
    await this.collection.createIndex(
      { skillGuid: 1, topicGuid: 1 },
      { name: "topic_skills_by_skill" },
    );
  }

  /**
   * Insert an edge. Idempotent: duplicate `_id` returns `{ inserted: false }`
   * without an error so callers can batch-add safely.
   */
  async add(data: AddTopicSkillData): Promise<{ inserted: boolean }> {
    const id = `${data.topicGuid}:${data.skillGuid}`;
    try {
      await this.collection.insertOne({
        _id: id as never,
        topicGuid: data.topicGuid,
        skillGuid: data.skillGuid,
        addedBy: data.addedBy,
        addedOn: new Date(),
      } as never);
      return { inserted: true };
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        return { inserted: false };
      }
      throw err;
    }
  }

  async remove(topicGuid: string, skillGuid: string): Promise<boolean> {
    const result = await this.collection.deleteOne({
      _id: `${topicGuid}:${skillGuid}` as never,
    });
    return (result.deletedCount ?? 0) > 0;
  }

  async countByTopic(topicGuid: string): Promise<number> {
    return this.collection.countDocuments({ topicGuid });
  }

  async countsByTopics(topicGuids: string[]): Promise<Map<string, number>> {
    if (topicGuids.length === 0) return new Map();
    const pipeline = [
      { $match: { topicGuid: { $in: topicGuids } } },
      { $group: { _id: "$topicGuid", count: { $sum: 1 } } },
    ];
    const rows = await this.collection.aggregate(pipeline).toArray();
    const out = new Map<string, number>();
    for (const g of topicGuids) out.set(g, 0);
    for (const row of rows) {
      out.set(row._id as string, (row.count as number) ?? 0);
    }
    return out;
  }

  async listSkillGuidsByTopic(topicGuid: string): Promise<string[]> {
    const docs = await this.collection
      .find({ topicGuid })
      .project({ skillGuid: 1, addedOn: 1 })
      .sort({ addedOn: -1 })
      .toArray();
    return docs.map((d) => d.skillGuid as string);
  }

  async deleteAllByTopic(topicGuid: string): Promise<number> {
    const result = await this.collection.deleteMany({ topicGuid });
    logger.info({ topicGuid, deleted: result.deletedCount }, "Topic membership cascade-deleted (by topic)");
    return result.deletedCount ?? 0;
  }

  async deleteAllBySkill(skillGuid: string): Promise<number> {
    const result = await this.collection.deleteMany({ skillGuid });
    logger.info({ skillGuid, deleted: result.deletedCount }, "Topic membership cascade-deleted (by skill)");
    return result.deletedCount ?? 0;
  }
}

export function mapTopicSkillDoc(doc: Document | null): TopicSkillDocument | null {
  if (!doc) return null;
  return {
    _id: doc._id as string,
    topicGuid: doc.topicGuid,
    skillGuid: doc.skillGuid,
    addedBy: doc.addedBy ?? "",
    addedOn: doc.addedOn ?? new Date(),
  };
}
