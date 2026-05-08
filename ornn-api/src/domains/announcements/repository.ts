/**
 * Announcement repository — one Mongo collection, `announcements`.
 *
 * Reads:
 *   - listAll(): admin table (newest first, every record).
 *   - findActive(now): public popup — single enabled record currently
 *     within its [startsAt, endsAt] window, picked by most-recent
 *     createdAt so admins can supersede a live one by simply creating
 *     a new enabled record.
 *
 * Writes are admin-driven CRUD. No fan-out, no batch jobs.
 *
 * @module domains/announcements/repository
 */

import { randomUUID } from "node:crypto";
import type { Collection, Db, Document } from "mongodb";
import pino from "pino";
import type { AnnouncementDocument } from "./types";

const logger = pino({ level: "info" }).child({ module: "announcementRepository" });

export interface CreateAnnouncementInput {
  title: string;
  bodyMarkdown: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  enabled: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  createdBy: string;
}

export interface UpdateAnnouncementInput {
  title?: string;
  bodyMarkdown?: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  enabled?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export class AnnouncementRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("announcements");
  }

  async ensureIndexes(): Promise<void> {
    try {
      // The "active" lookup filters on enabled + window bounds and orders
      // by createdAt; a single compound covers both the predicate selection
      // and the ordering well enough for the cardinality we expect (<<1k).
      await this.collection.createIndex({ enabled: 1, createdAt: -1 });
    } catch (err) {
      logger.error({ err }, "Failed to create announcements indexes");
    }
  }

  async create(input: CreateAnnouncementInput): Promise<AnnouncementDocument> {
    const now = new Date();
    const doc: Document = {
      _id: randomUUID() as unknown as Document["_id"],
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      ctaLabel: input.ctaLabel ?? null,
      ctaUrl: input.ctaUrl ?? null,
      enabled: input.enabled,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    await this.collection.insertOne(doc);
    return mapDoc(doc)!;
  }

  async listAll(): Promise<AnnouncementDocument[]> {
    const docs = await this.collection.find({}).sort({ createdAt: -1 }).toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  async findById(id: string): Promise<AnnouncementDocument | null> {
    const doc = await this.collection.findOne({ _id: id as unknown as Document["_id"] });
    return mapDoc(doc);
  }

  async findActive(now: Date): Promise<AnnouncementDocument | null> {
    const doc = await this.collection
      .find({
        enabled: true,
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();
    return mapDoc(doc);
  }

  async update(id: string, patch: UpdateAnnouncementInput): Promise<AnnouncementDocument | null> {
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) $set.title = patch.title;
    if (patch.bodyMarkdown !== undefined) $set.bodyMarkdown = patch.bodyMarkdown;
    if (patch.ctaLabel !== undefined) $set.ctaLabel = patch.ctaLabel;
    if (patch.ctaUrl !== undefined) $set.ctaUrl = patch.ctaUrl;
    if (patch.enabled !== undefined) $set.enabled = patch.enabled;
    if (patch.startsAt !== undefined) $set.startsAt = patch.startsAt;
    if (patch.endsAt !== undefined) $set.endsAt = patch.endsAt;
    await this.collection.updateOne({ _id: id as unknown as Document["_id"] }, { $set });
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.collection.deleteOne({ _id: id as unknown as Document["_id"] });
    return (res.deletedCount ?? 0) > 0;
  }
}

function mapDoc(doc: Document | null): AnnouncementDocument | null {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    title: String(doc.title ?? ""),
    bodyMarkdown: String(doc.bodyMarkdown ?? ""),
    ctaLabel: doc.ctaLabel == null ? null : String(doc.ctaLabel),
    ctaUrl: doc.ctaUrl == null ? null : String(doc.ctaUrl),
    enabled: Boolean(doc.enabled),
    startsAt: toNullableDate(doc.startsAt),
    endsAt: toNullableDate(doc.endsAt),
    createdBy: String(doc.createdBy ?? ""),
    createdAt: toDate(doc.createdAt),
    updatedAt: toDate(doc.updatedAt ?? doc.createdAt),
  };
}

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string | number);
}

function toNullableDate(v: unknown): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v as string | number);
}
