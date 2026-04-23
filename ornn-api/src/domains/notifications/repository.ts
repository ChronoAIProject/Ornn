/**
 * Notification repository — one Mongo collection, `notifications`.
 *
 * Writes are fire-and-forget from the notification service; reads are
 * per-user list + mark-read. No cross-user fan-out queries today.
 *
 * @module domains/notifications/repository
 */

import { randomUUID } from "node:crypto";
import type { Collection, Db, Document, Filter } from "mongodb";
import pino from "pino";
import type { NotificationCategory, NotificationDocument } from "./types";

const logger = pino({ level: "info" }).child({ module: "notificationRepository" });

export interface CreateNotificationInput {
  userId: string;
  category: NotificationCategory;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
}

export interface ListOptions {
  readonly limit?: number;
  /** If true, only include unread. */
  readonly unreadOnly?: boolean;
  /** ISO string or Date — return notifications created strictly before this. */
  readonly before?: Date;
}

export class NotificationRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("notifications");
  }

  async ensureIndexes(): Promise<void> {
    try {
      await Promise.all([
        this.collection.createIndex({ userId: 1, createdAt: -1 }),
        this.collection.createIndex({ userId: 1, readAt: 1 }),
      ]);
    } catch (err) {
      logger.error({ err }, "Failed to create notifications indexes");
    }
  }

  async create(input: CreateNotificationInput): Promise<NotificationDocument> {
    const doc: Document = {
      _id: randomUUID() as unknown as Document["_id"],
      userId: input.userId,
      category: input.category,
      title: input.title,
      body: input.body,
      link: input.link,
      data: input.data ?? {},
      readAt: null,
      createdAt: new Date(),
    };
    await this.collection.insertOne(doc);
    return mapDoc(doc)!;
  }

  async list(userId: string, options: ListOptions = {}): Promise<NotificationDocument[]> {
    const filter: Filter<Document> = { userId };
    if (options.unreadOnly) filter.readAt = null;
    if (options.before) filter.createdAt = { $lt: options.before };
    const docs = await this.collection
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(options.limit ?? 50, 200))
      .toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  async countUnread(userId: string): Promise<number> {
    return this.collection.countDocuments({ userId, readAt: null });
  }

  async markRead(userId: string, notificationId: string): Promise<NotificationDocument | null> {
    const now = new Date();
    await this.collection.updateOne(
      { _id: notificationId as unknown as Document["_id"], userId },
      { $set: { readAt: now } },
    );
    const doc = await this.collection.findOne({
      _id: notificationId as unknown as Document["_id"],
      userId,
    });
    return mapDoc(doc);
  }

  async markAllRead(userId: string): Promise<number> {
    const now = new Date();
    const res = await this.collection.updateMany(
      { userId, readAt: null },
      { $set: { readAt: now } },
    );
    return res.modifiedCount ?? 0;
  }
}

function mapDoc(doc: Document | null): NotificationDocument | null {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    userId: String(doc.userId),
    category: doc.category as NotificationCategory,
    title: String(doc.title ?? ""),
    body: doc.body ? String(doc.body) : undefined,
    link: doc.link ? String(doc.link) : undefined,
    data: (doc.data as Record<string, unknown>) ?? {},
    readAt: doc.readAt ? (doc.readAt instanceof Date ? doc.readAt : new Date(doc.readAt)) : null,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt),
  };
}
