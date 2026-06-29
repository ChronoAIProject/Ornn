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
import type {
  CreateNotificationInput,
  NotificationRepository,
  ListOptions,
} from "./repository";
import type { BroadcastRepository } from "../broadcasts/repository";
import type {
  BroadcastDocument,
  BroadcastReadReceiptDocument,
} from "../broadcasts/types";

class FakeNotificationRepo {
  rows: NotificationDocument[] = [];
  /** Captures every `emit` → `create` call so emitter tests can pin payloads. */
  created: CreateNotificationInput[] = [];
  /** When true, `create` rejects — exercises the emit swallow-on-reject path. */
  createShouldReject = false;
  /** Captures the most recent `list` options so clamp tests can pin the
   *  `limit` the service forwards to the repo (#920). */
  lastListOptions: ListOptions | undefined;

  async create(input: CreateNotificationInput): Promise<NotificationDocument> {
    if (this.createShouldReject) {
      throw new Error("simulated persistence failure");
    }
    this.created.push(input);
    const doc: NotificationDocument = {
      _id: `n-${this.created.length}`,
      userId: input.userId,
      category: input.category,
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.link !== undefined ? { link: input.link } : {}),
      data: input.data ?? {},
      readAt: null,
      createdAt: new Date(),
    };
    this.rows.push(doc);
    return doc;
  }

  async list(userId: string, options: ListOptions = {}): Promise<NotificationDocument[]> {
    this.lastListOptions = options;
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

describe("NotificationService — listFeedForUser limit clamp authority (#920)", () => {
  // Mirror the (unexported) service constants so the assertions read
  // intent-first. Keep in sync with service.ts.
  const MERGED_FEED_LIMIT_DEFAULT = 50;
  const MERGED_FEED_LIMIT_MAX = 200;

  test("limit: NaN falls back to the default page size", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.listFeedForUser("u1", { limit: NaN });
    const captured = notificationRepo.lastListOptions?.limit;
    expect(captured).toBe(MERGED_FEED_LIMIT_DEFAULT);
    expect(Number.isFinite(captured)).toBe(true);
  });

  test("limit: undefined falls back to the default page size", async () => {
    const { svc, notificationRepo } = makeService();
    // Pass an explicit-`undefined` limit. The service signature uses
    // exactOptionalPropertyTypes (no `undefined` in the value position),
    // so the literal is funnelled through `unknown` at the call
    // boundary — at runtime this exercises the same
    // `options.limit === undefined` branch the route hits when it drops
    // a malformed `?limit=` to undefined (#920).
    const opts = { limit: undefined } as unknown as { limit?: number };
    await svc.listFeedForUser("u1", opts);
    const captured = notificationRepo.lastListOptions?.limit;
    expect(captured).toBe(MERGED_FEED_LIMIT_DEFAULT);
    expect(Number.isFinite(captured)).toBe(true);
  });

  test("limit: 0 clamps up to the floor (1)", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.listFeedForUser("u1", { limit: 0 });
    const captured = notificationRepo.lastListOptions?.limit;
    expect(captured).toBe(1);
    expect(Number.isFinite(captured)).toBe(true);
  });

  test("limit: 9999 clamps down to the ceiling", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.listFeedForUser("u1", { limit: 9999 });
    const captured = notificationRepo.lastListOptions?.limit;
    expect(captured).toBe(MERGED_FEED_LIMIT_MAX);
    expect(Number.isFinite(captured)).toBe(true);
  });

  test("limit: Infinity clamps down to the ceiling (finite guard)", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.listFeedForUser("u1", { limit: Number.POSITIVE_INFINITY });
    const captured = notificationRepo.lastListOptions?.limit;
    // Infinity is not finite → defaults → still within [1, MAX].
    expect(captured).toBe(MERGED_FEED_LIMIT_DEFAULT);
    expect(Number.isFinite(captured)).toBe(true);
  });
});

describe("NotificationService — recipientUserIds filter (#502)", () => {
  test("listFeedForUser shows targeted broadcasts to recipients", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({
        _id: "b-targeted",
        recipientUserIds: ["u-1", "u-2"],
      }),
    );
    const feedU1 = await svc.listFeedForUser("u-1");
    expect(feedU1.map((i) => i._id)).toEqual(["b-targeted"]);
    const feedU2 = await svc.listFeedForUser("u-2");
    expect(feedU2.map((i) => i._id)).toEqual(["b-targeted"]);
  });

  test("listFeedForUser hides targeted broadcasts from non-recipients", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({
        _id: "b-targeted",
        recipientUserIds: ["u-1"],
      }),
    );
    const feedU3 = await svc.listFeedForUser("u-3");
    expect(feedU3).toEqual([]);
  });

  test("listFeedForUser still shows everyone-broadcasts (recipientUserIds: null)", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b-all", recipientUserIds: null }),
    );
    const feedU1 = await svc.listFeedForUser("u-1");
    const feedU99 = await svc.listFeedForUser("u-99");
    expect(feedU1.map((i) => i._id)).toEqual(["b-all"]);
    expect(feedU99.map((i) => i._id)).toEqual(["b-all"]);
  });

  test("listFeedForUser interleaves targeted + everyone-broadcasts per recipient", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({
        _id: "b-all",
        recipientUserIds: null,
        createdAt: new Date("2026-05-01T00:00:00Z"),
      }),
      makeBroadcast({
        _id: "b-targeted-u1",
        recipientUserIds: ["u-1"],
        createdAt: new Date("2026-05-10T00:00:00Z"),
      }),
      makeBroadcast({
        _id: "b-targeted-u2",
        recipientUserIds: ["u-2"],
        createdAt: new Date("2026-05-05T00:00:00Z"),
      }),
    );
    const feedU1 = await svc.listFeedForUser("u-1");
    expect(feedU1.map((i) => i._id)).toEqual(["b-targeted-u1", "b-all"]);
    const feedU2 = await svc.listFeedForUser("u-2");
    expect(feedU2.map((i) => i._id)).toEqual(["b-targeted-u2", "b-all"]);
    const feedU3 = await svc.listFeedForUser("u-3");
    expect(feedU3.map((i) => i._id)).toEqual(["b-all"]);
  });

  test("countUnread counts targeted broadcasts only for recipients", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b-all", recipientUserIds: null }),
      makeBroadcast({ _id: "b-targeted", recipientUserIds: ["u-1"] }),
    );
    // u-1 sees both unread: count = 2
    expect(await svc.countUnread("u-1")).toBe(2);
    // u-2 sees only the everyone-broadcast unread: count = 1
    expect(await svc.countUnread("u-2")).toBe(1);
  });

  test("markAllRead writes receipts only for visible broadcasts", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b-all", recipientUserIds: null }),
      makeBroadcast({ _id: "b-targeted-u1", recipientUserIds: ["u-1"] }),
      makeBroadcast({ _id: "b-targeted-u2", recipientUserIds: ["u-2"] }),
    );
    const changed = await svc.markAllRead("u-1");
    // u-1 marks: b-all + b-targeted-u1 = 2; b-targeted-u2 stays unread for u-1.
    expect(changed).toBe(2);
    const receiptKeys = broadcastRepo.receipts.map((r) => `${r.userId}:${r.broadcastId}`).sort();
    expect(receiptKeys).toEqual(["u-1:b-all", "u-1:b-targeted-u1"]);
    // u-2 is unaffected — markAllRead for u-1 does not write a receipt
    // for any broadcast u-2 can see.
    expect(await svc.countUnread("u-2")).toBe(2);
  });

  test("markRead on a targeted broadcast by a non-recipient throws NOTIFICATION_NOT_FOUND", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b-targeted", recipientUserIds: ["u-1"] }),
    );
    await expect(svc.markRead("u-3", "b-targeted")).rejects.toThrow(
      /Notification not found/,
    );
    // No receipt was written — the non-recipient can't even probe.
    expect(broadcastRepo.receipts).toHaveLength(0);
  });

  test("markRead on a targeted broadcast by a recipient succeeds", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b-targeted", recipientUserIds: ["u-1"] }),
    );
    const result = await svc.markRead("u-1", "b-targeted");
    expect("source" in result && result.source === "broadcast").toBe(true);
    expect(broadcastRepo.receipts).toHaveLength(1);
  });

  test("markManyRead silently skips targeted broadcasts the caller can't see", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b-all", recipientUserIds: null }),
      makeBroadcast({ _id: "b-targeted-other", recipientUserIds: ["u-99"] }),
    );
    // u-3 tries to mark both — only b-all should transition.
    const changed = await svc.markManyRead("u-3", ["b-all", "b-targeted-other"]);
    expect(changed).toBe(1);
    expect(broadcastRepo.receipts).toHaveLength(1);
    expect(broadcastRepo.receipts[0]?.broadcastId).toBe("b-all");
  });

  test("listFeedForUser unreadOnly + recipient filter compose correctly", async () => {
    const { svc, broadcastRepo } = makeService();
    broadcastRepo.broadcasts.push(
      makeBroadcast({ _id: "b-all-read", recipientUserIds: null }),
      makeBroadcast({ _id: "b-targeted-u1-read", recipientUserIds: ["u-1"] }),
      makeBroadcast({ _id: "b-targeted-u1-unread", recipientUserIds: ["u-1"] }),
      makeBroadcast({ _id: "b-targeted-u2", recipientUserIds: ["u-2"] }),
    );
    await broadcastRepo.markRead("u-1", "b-all-read");
    await broadcastRepo.markRead("u-1", "b-targeted-u1-read");
    const feed = await svc.listFeedForUser("u-1", { unreadOnly: true });
    expect(feed.map((i) => i._id)).toEqual(["b-targeted-u1-unread"]);
  });
});

describe("NotificationService — emitters", () => {
  test("notifyAuditCompleted — green verdict pins the passed payload", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.notifyAuditCompleted({
      ownerUserId: "owner-1",
      skillGuid: "guid abc",
      skillName: "My Skill",
      version: "1.0.0",
      verdict: "green",
      overallScore: 9.25,
    });
    expect(notificationRepo.created).toHaveLength(1);
    const sent = notificationRepo.created[0]!;
    expect(sent).toEqual({
      userId: "owner-1",
      category: "audit.completed",
      title: "Skill audit passed — My Skill v1.0.0 · score 9.3/10",
      body: "Audit verdict was green. No follow-up required.",
      // skillGuid is URL-encoded into the deep link.
      link: "/skills/guid%20abc/audits?version=1.0.0",
      data: {
        skillGuid: "guid abc",
        skillName: "My Skill",
        version: "1.0.0",
        verdict: "green",
        overallScore: 9.25,
      },
    });
  });

  test("notifyAuditCompleted — yellow/red verdict pins the flagged-risk payload", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.notifyAuditCompleted({
      ownerUserId: "owner-2",
      skillGuid: "abc",
      skillName: "Risky Skill",
      version: "2.1.0",
      verdict: "red",
      overallScore: 3,
    });
    const sent = notificationRepo.created[0]!;
    expect(sent.title).toBe("Skill audit flagged risk — Risky Skill v2.1.0 · score 3.0/10");
    expect(sent.body).toBe(
      "Audit found one or more flagged areas. Review the findings before continuing to share.",
    );
    expect(sent.category).toBe("audit.completed");
    expect(sent.data).toEqual({
      skillGuid: "abc",
      skillName: "Risky Skill",
      version: "2.1.0",
      verdict: "red",
      overallScore: 3,
    });
  });

  test("notifyAuditRiskyForConsumer pins the consumer-side payload", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.notifyAuditRiskyForConsumer({
      consumerUserId: "consumer-1",
      skillGuid: "abc",
      skillName: "Shared Skill",
      version: "1.2.3",
      verdict: "yellow",
      overallScore: 6.5,
    });
    const sent = notificationRepo.created[0]!;
    expect(sent).toEqual({
      userId: "consumer-1",
      category: "audit.risky_for_consumer",
      title: 'Skill "Shared Skill" v1.2.3 you have access to was flagged risky in audit',
      body: "Verdict: yellow · score 6.5/10. Use with caution.",
      link: "/skills/abc/audits?version=1.2.3",
      data: {
        skillGuid: "abc",
        skillName: "Shared Skill",
        version: "1.2.3",
        verdict: "yellow",
        overallScore: 6.5,
      },
    });
  });

  test("notifySkillsetMemberUnreadable pins the owner-side payload (#1136)", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.notifySkillsetMemberUnreadable({
      ownerUserId: "owner-9",
      skillsetGuid: "ss guid",
      skillsetName: "My Bundle",
      unreadableMembers: ["secret-tools@1.0"],
    });
    expect(notificationRepo.created).toHaveLength(1);
    const sent = notificationRepo.created[0]!;
    expect(sent.userId).toBe("owner-9");
    expect(sent.category).toBe("skillset.member_unreadable");
    expect(sent.title).toBe('A skill in your skillset "My Bundle" is no longer accessible to you');
    // Single member → singular phrasing + the member listed.
    expect(sent.body).toContain("1 member skill is");
    expect(sent.body).toContain("secret-tools@1.0");
    // Guid is URL-encoded into the deep link.
    expect(sent.link).toBe("/skillsets/ss%20guid");
    expect(sent.data).toEqual({
      skillsetGuid: "ss guid",
      skillsetName: "My Bundle",
      unreadableMembers: ["secret-tools@1.0"],
    });
  });

  test("notifySkillsetMemberUnreadable pluralizes for multiple members (#1136)", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.notifySkillsetMemberUnreadable({
      ownerUserId: "owner-9",
      skillsetGuid: "g",
      skillsetName: "Bundle",
      unreadableMembers: ["a@1.0", "b@2.0"],
    });
    const sent = notificationRepo.created[0]!;
    expect(sent.body).toContain("2 member skills are");
    expect(sent.body).toContain("a@1.0, b@2.0");
  });

  test("notifyQuotaCreditsGranted — with a note inlines the note in the body", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.notifyQuotaCreditsGranted({
      targetUserId: "user-1",
      surface: "playground",
      amount: 1500,
      note: "Conference promo",
      adminDisplayName: "Alice",
    });
    const sent = notificationRepo.created[0]!;
    expect(sent.userId).toBe("user-1");
    expect(sent.category).toBe("quota.credits_granted");
    expect(sent.title).toBe("Admin granted you +1,500 playground credits");
    expect(sent.body).toBe("Granted by Alice. Note: Conference promo");
    // No deep link target for quota grants today.
    expect(sent.link).toBeUndefined();
    expect(sent.data).toEqual({
      surface: "playground",
      amount: 1500,
      adminDisplayName: "Alice",
    });
  });

  test("notifyQuotaCreditsGranted — without a note uses the default body", async () => {
    const { svc, notificationRepo } = makeService();
    await svc.notifyQuotaCreditsGranted({
      targetUserId: "user-2",
      surface: "skillGen",
      amount: 50,
      adminDisplayName: "Bob",
    });
    const sent = notificationRepo.created[0]!;
    expect(sent.title).toBe("Admin granted you +50 skill-generation credits");
    expect(sent.body).toBe(
      "Granted by Bob. Credits never expire and stack on top of your monthly base.",
    );
  });

  test("notifyQuotaModelChange pins the migration-notice payload", async () => {
    // Live caller: scripts/migrate-quota-to-buckets.ts (Story 10.3) calls
    // this with { targetUserId, monthMarker } for each migrated user.
    const { svc, notificationRepo } = makeService();
    await svc.notifyQuotaModelChange({
      targetUserId: "user-3",
      monthMarker: "2026-05",
    });
    const sent = notificationRepo.created[0]!;
    expect(sent).toEqual({
      userId: "user-3",
      category: "quota.credits_granted",
      title: "Quota model update — your existing credits expire at month end",
      body:
        "Your previously granted credits have been migrated to current-month-only credits " +
        "ending 2026-05. Contact admin if you need them re-issued next month.",
      data: { kind: "model_change", monthMarker: "2026-05" },
    });
  });

  test("emit swallows a repo create rejection — caller never sees the error", async () => {
    const { svc, notificationRepo } = makeService();
    notificationRepo.createShouldReject = true;
    // Must resolve (not reject) — notifications never block the caller.
    await expect(
      svc.notifyAuditCompleted({
        ownerUserId: "owner-x",
        skillGuid: "abc",
        skillName: "S",
        version: "1.0.0",
        verdict: "green",
        overallScore: 8,
      }),
    ).resolves.toBeUndefined();
    expect(notificationRepo.created).toHaveLength(0);
  });
});

describe("NotificationService — legacy list passthrough", () => {
  test("list returns only per-user rows, honouring limit + unreadOnly", async () => {
    const { svc, notificationRepo } = makeService();
    notificationRepo.rows.push(
      makeNotification({
        _id: "n1",
        userId: "u1",
        createdAt: new Date("2026-05-01T00:00:00Z"),
      }),
      makeNotification({
        _id: "n2",
        userId: "u1",
        readAt: new Date(),
        createdAt: new Date("2026-05-02T00:00:00Z"),
      }),
      makeNotification({ _id: "n3", userId: "other" }),
    );
    const all = await svc.list("u1");
    expect(all.map((n) => n._id)).toEqual(["n2", "n1"]);
    const unread = await svc.list("u1", { unreadOnly: true });
    expect(unread.map((n) => n._id)).toEqual(["n1"]);
    const limited = await svc.list("u1", { limit: 1 });
    expect(limited).toHaveLength(1);
  });
});
