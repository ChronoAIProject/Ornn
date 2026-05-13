/**
 * Announcement repository — one Mongo collection, `announcements`.
 *
 * Reads:
 *   - listAll(): admin table (newest first, every record).
 *   - findActive(now): public popup — single enabled record currently
 *     within its [startsAt, endsAt] window, picked by most-recent
 *     createdAt so admins can supersede a live one by simply creating
 *     a new enabled record.
 *   - findAllReleased(now): public News page (#357) — every enabled
 *     record whose start gate has elapsed, newest first. Past/expired
 *     records (endsAt < now) are intentionally retained: the News page
 *     is an archive.
 *
 * Writes are admin-driven CRUD. No fan-out, no batch jobs.
 *
 * Content is **bilingual** — title, body, and CTA label are stored
 * per-locale (`titleEn` / `titleZh` etc.). The shape on the read path
 * is symmetric; consumers (popup + News page) resolve the active
 * locale at render time. EN is the canonical / required content; ZH
 * is optional. A boot migration (see `migration.ts`) backfills the
 * per-locale fields from legacy single-locale `title` / `bodyMarkdown`
 * / `ctaLabel` columns; this repo's mapper is tolerant of either
 * shape during the rollout window.
 *
 * @module domains/announcements/repository
 */

import { randomUUID } from "node:crypto";
import type { Collection, Db, Document } from "mongodb";
import pino from "pino";
import type { AnnouncementDocument } from "./types";

const logger = pino({ level: "info" }).child({ module: "announcementRepository" });

export interface CreateAnnouncementInput {
  titleEn: string;
  titleZh: string;
  bodyMarkdownEn: string;
  bodyMarkdownZh: string;
  ctaLabelEn?: string | null;
  ctaLabelZh?: string | null;
  ctaUrl?: string | null;
  enabled: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  createdBy: string;
}

export interface UpdateAnnouncementInput {
  titleEn?: string;
  titleZh?: string;
  bodyMarkdownEn?: string;
  bodyMarkdownZh?: string;
  ctaLabelEn?: string | null;
  ctaLabelZh?: string | null;
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
      titleEn: input.titleEn,
      titleZh: input.titleZh,
      bodyMarkdownEn: input.bodyMarkdownEn,
      bodyMarkdownZh: input.bodyMarkdownZh,
      ctaLabelEn: input.ctaLabelEn ?? null,
      ctaLabelZh: input.ctaLabelZh ?? null,
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

  /**
   * Released announcements for the public News page (#357): enabled,
   * `startsAt` either null or already elapsed, newest first. Does NOT
   * filter on `endsAt` — historical records are part of the archive
   * surface.
   */
  async findAllReleased(now: Date): Promise<AnnouncementDocument[]> {
    const docs = await this.collection
      .find({
        enabled: true,
        $or: [{ startsAt: null }, { startsAt: { $lte: now } }],
      })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  async update(id: string, patch: UpdateAnnouncementInput): Promise<AnnouncementDocument | null> {
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.titleEn !== undefined) $set.titleEn = patch.titleEn;
    if (patch.titleZh !== undefined) $set.titleZh = patch.titleZh;
    if (patch.bodyMarkdownEn !== undefined) $set.bodyMarkdownEn = patch.bodyMarkdownEn;
    if (patch.bodyMarkdownZh !== undefined) $set.bodyMarkdownZh = patch.bodyMarkdownZh;
    if (patch.ctaLabelEn !== undefined) $set.ctaLabelEn = patch.ctaLabelEn;
    if (patch.ctaLabelZh !== undefined) $set.ctaLabelZh = patch.ctaLabelZh;
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

/**
 * Map a Mongo doc into the typed shape. Tolerant of legacy single-
 * locale fields (`title` / `bodyMarkdown` / `ctaLabel`): when the
 * per-locale columns are missing, falls back to the legacy value as
 * a temporary safety net. The boot migration owns the real backfill;
 * this fallback is just so reads keep working between deploy of the
 * new code and the migration's first pass.
 */
function mapDoc(doc: Document | null): AnnouncementDocument | null {
  if (!doc) return null;
  const legacyTitle = typeof doc.title === "string" ? doc.title : "";
  const legacyBody = typeof doc.bodyMarkdown === "string" ? doc.bodyMarkdown : "";
  const legacyCta = doc.ctaLabel == null ? null : String(doc.ctaLabel);
  return {
    _id: String(doc._id),
    titleEn: typeof doc.titleEn === "string" ? doc.titleEn : legacyTitle,
    titleZh: typeof doc.titleZh === "string" ? doc.titleZh : legacyTitle,
    bodyMarkdownEn:
      typeof doc.bodyMarkdownEn === "string" ? doc.bodyMarkdownEn : legacyBody,
    bodyMarkdownZh:
      typeof doc.bodyMarkdownZh === "string" ? doc.bodyMarkdownZh : legacyBody,
    ctaLabelEn:
      doc.ctaLabelEn === null
        ? null
        : typeof doc.ctaLabelEn === "string"
          ? doc.ctaLabelEn
          : legacyCta,
    ctaLabelZh:
      doc.ctaLabelZh === null
        ? null
        : typeof doc.ctaLabelZh === "string"
          ? doc.ctaLabelZh
          : legacyCta,
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
