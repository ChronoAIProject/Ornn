/**
 * NotificationService — merged-feed tests for #500.
 *
 * Covers the broadcast-aware additions to the existing notification
 * service:
 *
 *   - `listFeedForUser` interleaves per-user notifications + broadcasts
 *     by `createdAt` desc, attaches `readAt` per-broadcast from the
 *     receipts collection, and discriminates by `source`.
 *   - `countUnread` rolls up per-user unread + unread broadcasts.
 *   - `markRead` routes a single id to either collection by lookup;
 *     unknown id surfaces NOTIFICATION_NOT_FOUND.
 *   - `markManyRead` skips unknown ids without failing the batch.
 *   - `markAllRead` inserts receipts for every currently-unread
 *     broadcast in addition to clearing per-user unread.
 *
 * Uses in-memory fakes for both repositories so we can exercise the
 * routing logic without standing up Mongo. The integration smoke test
 * over real Mongo lives in `tests/integration/`.
 *
 * @module domains/notifications/service.test
 */

import { describe, expect, test } from "bun:test";
import { NotificationService } from "./service";
import type { NotificationDocument } from "./types";
import type { NotificationRepository, ListOptions } from "./repository";
import type { BroadcastRepository } from "../broadcasts/repository";
import type {
  BroadcastDocument,
  BroadcastReadReceiptDocument,
} from "../broadcasts/types";

class FakeNotificationRepo {
  rows: NotificationDocument[] = [];

  async list(userId: string, options: ListOptions = {}): Promise<NotificationDocument[]> {
    let out = this.rows.filter((r) => r.userId === userId);
    if (options.unreadOnly) out = out.filter((r) => !r.readAt);
    out = [...out].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (options.limit) out = out.slice(0, options.limit);
    return out;
  }

  async countUnread(userId: string): Promise<number> {
    return this.rows.filter((r) => r.userId === userId && !r.readAt).length;
  }

  async markRead(userId: string, id: string): Promise<NotificationDocument | null> {
    const idx = this.rows.findIndex((r) => r.userId === userId && r._id === id);
    if (idx === -1) return null;
    const updated: NotificationDocument = { ...this.rows[idx]!, readAt: new Date() };
    this.rows[idx] = updated;
    return updated;
  }

  async markAllRead(userId: string): Promise<number> {
    let changed = 0;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i]!;
      if (r.userId === userId && !r.readAt) {
        this.rows[i] = { ...r, readAt: new Date() };
        changed++;
      }
    }
    return changed;
  }
}

class FakeBroadcastRepo {
  broadcasts: BroadcastDocument[] = [];
  receipts: BroadcastReadReceiptDocument[] = [];

  async listAll(): Promise<BroadcastDocument[]> {
    return [...this.broadcasts].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async getById(id: string): Promise<BroadcastDocument | null> {
    return this.broadcasts.find((b) => b._id === id) ?? null;
  }

  async markRead(userId: string, broadcastId: string): Promise<BroadcastReadReceiptDocument> {
    const existing = this.receipts.find(
      (r) => r.userId === userId && r.broadcastId === broadcastId,
    );
    if (existing) return existing;
    const doc: BroadcastReadReceiptDocument = {
      _id: `r-${this.receipts.length + 1}`,
      userId,
      broadcastId,
      readAt: new Date(),
    };
    this.receipts.push(doc);
    return doc;
  }

  async markManyRead(
    userId: string,
    broadcastIds: readonly string[],
  ): Promise<number> {
    let inserted = 0;
    for (const id of broadcastIds) {
      const before = this.receipts.length;
      await this.markRead(userId, id);
      if (this.receipts.length > before) inserted++;
    }
    return inserted;
  }

  async unreadBroadcastIdsForUser(userId: string): Promise<string[]> {
    const readIds = new Set(
      this.receipts.filter((r) => r.userId === userId).map((r) => r.broadcastId),
    );
    return this.broadcasts.filter((b) => !readIds.has(b._id)).map((b) => b._id);
  }

  async hasUserReadBroadcastsMap(
    userId: string,
    broadcastIds: readonly string[],
  ): Promise<Record<string, Date | undefined>> {
    const out: Record<string, Date | undefined> = {};
    for (const id of broadcastIds) {
      const receipt = this.receipts.find(
        (r) => r.userId === userId && r.broadcastId === id,
      );
      if (receipt) out[id] = receipt.readAt;
    }
    return out;
  }
}

function makeService() {
  const notificationRepo = new FakeNotificationRepo();
  const broadcastRepo = new FakeBroadcastRepo();
  const svc = new NotificationService({
    notificationRepo: notificationRepo as unknown as NotificationRepository,
    broadcastRepo: broadcastRepo as unknown as BroadcastRepository,
  });
  return { svc, notificationRepo, broadcastRepo };
}

function makeNotification(
  overrides: Partial<NotificationDocument> & Pick<NotificationDocument, "_id" | "userId">,
): NotificationDocument {
  return {
    category: "audit.completed",
    title: "n",
    data: {},
    readAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeBroadcast(overrides: Partial<BroadcastDocument> & { _id: string }): BroadcastDocument {
  return {
    titleI18n: { en: "Hi", zh: "嗨" },
    bodyMarkdownI18n: { en: "Body", zh: "内容" },
    createdBy: "u-admin",
    updatedBy: "u-admin",
    recipientUserIds: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("NotificationService — merged feed (#500)", () => {
  test("listFeedForUser interleaves per-user + broadcasts by createdAt desc", async () => {
    const { svc, notificationRepo, broadcastRepo } = makeService();
    notificationRepo.rows.push(
      makeNotification({
        _id: "n1",
        userId: "u1",
        title: "user-old",
        createdAt: new Date("2026-05-01T00:00:00Z"),
      }),
      makeNotification({
        _id: "n2",
        userId: "u1",
        title: "user-newest",
        createdAt: new Date("2026-05-10T00:00:00Z"),
      }),
    );
    broadcastRepo.broadcasts.push(
      makeBroadcast({
        _id: "b1",
        titleI18n: { en: "bcast-mid", zh: "中" },
        createdAt: new Date("2026-05-05T00:00:00Z"),
      }),
    );
    const feed = await svc.listFeedForUser("u1");
    expect(feed.map((i) => i._id)).toEqual(["n2", "b1", "n1"]);
    expect(feed[0]?.source).toBe("user");
    expect(feed[1]?.source).toBe("broadcast");
    expect(feed[2]?.source).toBe("user");
  });

  test("listFeedForUser left-joins read state per-broadcast", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b-read", createdAt: new Date("2026-05-10T00:00:00Z") }),
      makeBroadcast({ _id: "b-unread", createdAt: new Date("2026-05-05T00:00:00Z") }),
    );
    await broadcastRepo.markRead("u1", "b-read");
    const feed = await svc.listFeedForUser("u1");
    const readItem = feed.find((i) => i._id === "b-read");
    const unreadItem = feed.find((i) => i._id === "b-unread");
    expect(readItem?.readAt).toBeInstanceOf(Date);
    expect(unreadItem?.readAt).toBeNull();
  });

  test("listFeedForUser unread filter excludes read broadcasts AND read user notifs", async () => {
    const { svc, notificationRepo, broadcastRepo } = makeService();
    notificationRepo.rows.push(
      makeNotification({ _id: "n-read", userId: "u1", readAt: new Date() }),
      makeNotification({ _id: "n-unread", userId: "u1" }),
    );
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b-read" }),
      makeBroadcast({ _id: "b-unread" }),
    );
    await broadcastRepo.markRead("u1", "b-read");
    const feed = await svc.listFeedForUser("u1", { unreadOnly: true });
    expect(feed.map((i) => i._id).sort()).toEqual(["b-unread", "n-unread"].sort());
  });

  test("countUnread sums per-user unread + unread broadcasts", async () => {
    const { svc, notificationRepo, broadcastRepo } = makeService();
    notificationRepo.rows.push(
      makeNotification({ _id: "n1", userId: "u1" }),
      makeNotification({ _id: "n2", userId: "u1" }),
      makeNotification({ _id: "n3", userId: "u1", readAt: new Date() }),
    );
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b1" }),
      makeBroadcast({ _id: "b2" }),
    );
    await broadcastRepo.markRead("u1", "b1"); // 1 unread broadcast left
    const count = await svc.countUnread("u1");
    expect(count).toBe(3); // 2 unread notifs + 1 unread broadcast
  });

  test("markRead routes by id type — per-user notification path", async () => {
    const { svc, notificationRepo } = makeService();
    notificationRepo.rows.push(makeNotification({ _id: "n1", userId: "u1" }));
    const result = await svc.markRead("u1", "n1");
    expect("title" in result).toBe(true);
    expect((result as NotificationDocument).readAt).toBeInstanceOf(Date);
  });

  test("markRead routes by id type — broadcast path inserts receipt", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(makeBroadcast({ _id: "b1" }));
    const result = await svc.markRead("u1", "b1");
    expect("source" in result && result.source === "broadcast").toBe(true);
    expect(broadcastRepo.receipts).toHaveLength(1);
  });

  test("markRead with unknown id throws NOTIFICATION_NOT_FOUND", async () => {
    const { svc } = makeService();
    await expect(svc.markRead("u1", "nope")).rejects.toThrow(/Notification not found/);
  });

  test("markManyRead handles mixed per-user + broadcast ids", async () => {
    const { svc, notificationRepo, broadcastRepo } = makeService();
    notificationRepo.rows.push(makeNotification({ _id: "n1", userId: "u1" }));
    broadcastRepo.broadcasts.push(makeBroadcast({ _id: "b1" }));
    const changed = await svc.markManyRead("u1", ["n1", "b1"]);
    expect(changed).toBe(2);
    expect(notificationRepo.rows[0]!.readAt).toBeInstanceOf(Date);
    expect(broadcastRepo.receipts).toHaveLength(1);
  });

  test("markManyRead silently skips unknown ids without throwing", async () => {
    const { svc, notificationRepo } = makeService();
    notificationRepo.rows.push(makeNotification({ _id: "n1", userId: "u1" }));
    const changed = await svc.markManyRead("u1", ["n1", "unknown-id", "another"]);
    expect(changed).toBe(1);
    expect(notificationRepo.rows[0]!.readAt).toBeInstanceOf(Date);
  });

  test("markManyRead with empty ids is a no-op", async () => {
    const { svc } = makeService();
    const changed = await svc.markManyRead("u1", []);
    expect(changed).toBe(0);
  });

  test("markAllRead clears per-user unread AND writes broadcast receipts", async () => {
    const { svc, notificationRepo, broadcastRepo } = makeService();
    notificationRepo.rows.push(
      makeNotification({ _id: "n1", userId: "u1" }),
      makeNotification({ _id: "n2", userId: "u1" }),
    );
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b1" }),
      makeBroadcast({ _id: "b2" }),
    );
    const total = await svc.markAllRead("u1");
    expect(total).toBe(4);
    expect(notificationRepo.rows.every((r) => r.readAt)).toBe(true);
    expect(broadcastRepo.receipts).toHaveLength(2);
  });

  test("markAllRead is idempotent — second call returns 0", async () => {
    const { svc, notificationRepo, broadcastRepo } = makeService();
    notificationRepo.rows.push(makeNotification({ _id: "n1", userId: "u1" }));
    broadcastRepo.broadcasts.push(makeBroadcast({ _id: "b1" }));
    await svc.markAllRead("u1");
    const second = await svc.markAllRead("u1");
    expect(second).toBe(0);
  });

  test("listFeedForUser works without a broadcasts repo (legacy callers)", async () => {
    const notificationRepo = new FakeNotificationRepo();
    notificationRepo.rows.push(makeNotification({ _id: "n1", userId: "u1" }));
    const svc = new NotificationService({
      notificationRepo: notificationRepo as unknown as NotificationRepository,
    });
    const feed = await svc.listFeedForUser("u1");
    expect(feed).toHaveLength(1);
    expect(feed[0]?.source).toBe("user");
    expect(await svc.countUnread("u1")).toBe(1);
    expect(await svc.markAllRead("u1")).toBe(1);
  });
});
