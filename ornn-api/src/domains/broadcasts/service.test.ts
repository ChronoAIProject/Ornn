/**
 * BroadcastService unit tests against an in-memory repository fake.
 *
 * Covers admin business logic that lives on top of the repo:
 *   - listAdmin enriches every broadcast with `readCount` from a
 *     single grouped query.
 *   - create / update / delete log + propagate errors correctly.
 *   - delete cascades receipts via `deleteAllForBroadcast`.
 *   - delete on missing id surfaces a 404 AppError.
 *
 * @module domains/broadcasts/service.test
 */

import { describe, expect, test } from "bun:test";
import { BroadcastService } from "./service";
import type {
  BroadcastRepository,
  CreateBroadcastDocInput,
  UpdateBroadcastDocInput,
} from "./repository";
import type {
  BroadcastDocument,
  BroadcastReadReceiptDocument,
} from "./types";

class FakeRepo {
  private broadcasts = new Map<string, BroadcastDocument>();
  private receipts = new Map<string, BroadcastReadReceiptDocument>();
  private nextId = 0;
  public deleteAllForBroadcastCalls: string[] = [];

  async ensureIndexes(): Promise<void> {}

  async create(input: CreateBroadcastDocInput): Promise<BroadcastDocument> {
    const now = new Date();
    const id = `b-${++this.nextId}`;
    const doc: BroadcastDocument = {
      _id: id,
      titleI18n: { en: input.titleI18n.en, zh: input.titleI18n.zh },
      bodyMarkdownI18n: {
        en: input.bodyMarkdownI18n.en,
        zh: input.bodyMarkdownI18n.zh,
      },
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      recipientUserIds:
        input.recipientUserIds && input.recipientUserIds.length > 0
          ? [...input.recipientUserIds]
          : null,
      createdAt: now,
      updatedAt: now,
    };
    this.broadcasts.set(id, doc);
    return doc;
  }

  async listAll(): Promise<BroadcastDocument[]> {
    return [...this.broadcasts.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async getById(id: string): Promise<BroadcastDocument | null> {
    return this.broadcasts.get(id) ?? null;
  }

  async update(
    id: string,
    patch: UpdateBroadcastDocInput,
  ): Promise<BroadcastDocument | null> {
    const existing = this.broadcasts.get(id);
    if (!existing) return null;
    const next: BroadcastDocument = {
      ...existing,
      titleI18n: patch.titleI18n
        ? {
            en: patch.titleI18n.en ?? existing.titleI18n.en,
            zh: patch.titleI18n.zh ?? existing.titleI18n.zh,
          }
        : existing.titleI18n,
      bodyMarkdownI18n: patch.bodyMarkdownI18n
        ? {
            en: patch.bodyMarkdownI18n.en ?? existing.bodyMarkdownI18n.en,
            zh: patch.bodyMarkdownI18n.zh ?? existing.bodyMarkdownI18n.zh,
          }
        : existing.bodyMarkdownI18n,
      updatedBy: patch.updatedBy,
      updatedAt: new Date(),
    };
    this.broadcasts.set(id, next);
    return next;
  }

  async delete(id: string): Promise<boolean> {
    return this.broadcasts.delete(id);
  }

  async markRead(userId: string, broadcastId: string): Promise<BroadcastReadReceiptDocument> {
    const key = `${userId}:${broadcastId}`;
    const existing = this.receipts.get(key);
    if (existing) return existing;
    const doc: BroadcastReadReceiptDocument = {
      _id: `r-${this.receipts.size + 1}`,
      userId,
      broadcastId,
      readAt: new Date(),
    };
    this.receipts.set(key, doc);
    return doc;
  }

  async markManyRead(
    userId: string,
    broadcastIds: readonly string[],
  ): Promise<number> {
    let inserted = 0;
    for (const id of broadcastIds) {
      const key = `${userId}:${id}`;
      if (!this.receipts.has(key)) {
        await this.markRead(userId, id);
        inserted++;
      }
    }
    return inserted;
  }

  async deleteAllForBroadcast(broadcastId: string): Promise<number> {
    this.deleteAllForBroadcastCalls.push(broadcastId);
    let removed = 0;
    for (const [key, receipt] of this.receipts.entries()) {
      if (receipt.broadcastId === broadcastId) {
        this.receipts.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async readCountForBroadcast(broadcastId: string): Promise<number> {
    let count = 0;
    for (const receipt of this.receipts.values()) {
      if (receipt.broadcastId === broadcastId) count++;
    }
    return count;
  }

  async readCountsForBroadcasts(
    broadcastIds: readonly string[],
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of broadcastIds) {
      const count = await this.readCountForBroadcast(id);
      if (count > 0) out[id] = count;
    }
    return out;
  }

  async unreadBroadcastIdsForUser(userId: string): Promise<string[]> {
    const ids = [...this.broadcasts.keys()];
    return ids.filter((id) => !this.receipts.has(`${userId}:${id}`));
  }

  async hasUserReadBroadcastsMap(
    userId: string,
    broadcastIds: readonly string[],
  ): Promise<Record<string, Date | undefined>> {
    const out: Record<string, Date | undefined> = {};
    for (const id of broadcastIds) {
      const receipt = this.receipts.get(`${userId}:${id}`);
      if (receipt) out[id] = receipt.readAt;
    }
    return out;
  }

  // Test helper — surface the inner receipt map so assertions can
  // inspect cascade behaviour.
  getReceiptCount(): number {
    return this.receipts.size;
  }
}

function makeService() {
  const repo = new FakeRepo();
  const svc = new BroadcastService({ repo: repo as unknown as BroadcastRepository });
  return { svc, repo };
}

const baseInput = {
  titleI18n: { en: "Hello", zh: "你好" },
  bodyMarkdownI18n: { en: "World", zh: "世界" },
  createdBy: "u-admin",
} as const;

describe("BroadcastService", () => {
  test("listAdmin returns an empty array when no broadcasts exist", async () => {
    const { svc } = makeService();
    expect(await svc.listAdmin()).toEqual([]);
  });

  test("create returns an admin response with readCount 0", async () => {
    const { svc } = makeService();
    const created = await svc.create(baseInput);
    expect(created.titleI18n).toEqual({ en: "Hello", zh: "你好" });
    expect(created.bodyMarkdownI18n).toEqual({ en: "World", zh: "世界" });
    expect(created.createdBy).toBe("u-admin");
    expect(created.updatedBy).toBe("u-admin");
    expect(created.readCount).toBe(0);
    expect(typeof created.createdAt).toBe("string");
    expect(typeof created.updatedAt).toBe("string");
  });

  test("listAdmin enriches each broadcast with its readCount", async () => {
    const { svc, repo } = makeService();
    const b1 = await svc.create(baseInput);
    const b2 = await svc.create(baseInput);
    await repo.markRead("u-1", b1.id);
    await repo.markRead("u-2", b1.id);
    await repo.markRead("u-1", b2.id);
    const items = await svc.listAdmin();
    const byId = Object.fromEntries(items.map((i) => [i.id, i.readCount]));
    expect(byId[b1.id]).toBe(2);
    expect(byId[b2.id]).toBe(1);
  });

  test("update merges patch + bumps updatedBy", async () => {
    const { svc } = makeService();
    const created = await svc.create(baseInput);
    const updated = await svc.update(created.id, {
      titleI18n: { en: "Hi" },
      updatedBy: "u-other",
    });
    expect(updated.titleI18n).toEqual({ en: "Hi", zh: "你好" });
    expect(updated.bodyMarkdownI18n).toEqual({ en: "World", zh: "世界" });
    expect(updated.updatedBy).toBe("u-other");
    expect(updated.createdBy).toBe("u-admin");
  });

  test("update on missing id throws BROADCAST_NOT_FOUND", async () => {
    const { svc } = makeService();
    await expect(
      svc.update("does-not-exist", { updatedBy: "u" }),
    ).rejects.toThrow(/Broadcast not found/);
  });

  test("delete cascades receipts via deleteAllForBroadcast", async () => {
    const { svc, repo } = makeService();
    const created = await svc.create(baseInput);
    await repo.markRead("u-1", created.id);
    await repo.markRead("u-2", created.id);
    expect(repo.getReceiptCount()).toBe(2);
    await svc.delete(created.id);
    expect(repo.deleteAllForBroadcastCalls).toEqual([created.id]);
    expect(repo.getReceiptCount()).toBe(0);
  });

  test("delete on missing id throws BROADCAST_NOT_FOUND", async () => {
    const { svc } = makeService();
    await expect(svc.delete("does-not-exist")).rejects.toThrow(/Broadcast not found/);
  });

  test("getById surfaces 404 for missing id", async () => {
    const { svc } = makeService();
    await expect(svc.getById("does-not-exist")).rejects.toThrow(/Broadcast not found/);
  });
});
