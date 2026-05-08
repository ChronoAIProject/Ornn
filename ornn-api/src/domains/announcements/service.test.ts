/**
 * AnnouncementService unit tests against an in-memory repository fake.
 *
 * Covers:
 *   - getActive() picks the most recent record matching enabled + window.
 *   - Disabled records and out-of-window records are filtered out.
 *   - create/update reject inverted [startsAt, endsAt] windows.
 *   - update on a missing id surfaces a 404 AppError.
 *
 * @module domains/announcements/service.test
 */

import { describe, expect, it } from "bun:test";
import { AnnouncementService } from "./service";
import type {
  AnnouncementRepository,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from "./repository";
import type { AnnouncementDocument } from "./types";

class FakeRepo {
  private rows = new Map<string, AnnouncementDocument>();
  private nextId = 0;

  async ensureIndexes(): Promise<void> {}

  async create(input: CreateAnnouncementInput): Promise<AnnouncementDocument> {
    const now = new Date();
    const id = `a-${++this.nextId}`;
    const doc: AnnouncementDocument = {
      _id: id,
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
    this.rows.set(id, doc);
    return doc;
  }

  async listAll(): Promise<AnnouncementDocument[]> {
    return [...this.rows.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async findById(id: string): Promise<AnnouncementDocument | null> {
    return this.rows.get(id) ?? null;
  }

  async findActive(now: Date): Promise<AnnouncementDocument | null> {
    const matches = [...this.rows.values()]
      .filter(
        (d) =>
          d.enabled &&
          (d.startsAt === null || d.startsAt.getTime() <= now.getTime()) &&
          (d.endsAt === null || d.endsAt.getTime() > now.getTime()),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  }

  async update(
    id: string,
    patch: UpdateAnnouncementInput,
  ): Promise<AnnouncementDocument | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const next: AnnouncementDocument = {
      ...existing,
      title: patch.title !== undefined ? patch.title : existing.title,
      bodyMarkdown:
        patch.bodyMarkdown !== undefined ? patch.bodyMarkdown : existing.bodyMarkdown,
      ctaLabel: patch.ctaLabel !== undefined ? patch.ctaLabel : existing.ctaLabel,
      ctaUrl: patch.ctaUrl !== undefined ? patch.ctaUrl : existing.ctaUrl,
      enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
      startsAt: patch.startsAt !== undefined ? patch.startsAt : existing.startsAt,
      endsAt: patch.endsAt !== undefined ? patch.endsAt : existing.endsAt,
      updatedAt: new Date(),
    };
    this.rows.set(id, next);
    return next;
  }

  async delete(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  // The fake force-overrides createdAt for ordering tests.
  setCreatedAt(id: string, when: Date): void {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, createdAt: when });
  }
}

function makeService(now: Date = new Date("2026-05-08T12:00:00Z")) {
  const repo = new FakeRepo();
  const svc = new AnnouncementService({
    repo: repo as unknown as AnnouncementRepository,
    clock: () => now,
  });
  return { svc, repo };
}

const baseInput = {
  title: "Hello",
  bodyMarkdown: "World",
  enabled: true,
  createdBy: "u-admin",
} as const;

describe("AnnouncementService", () => {
  it("getActive returns null when no records exist", async () => {
    const { svc } = makeService();
    expect(await svc.getActive()).toBeNull();
  });

  it("getActive picks the most recent enabled in-window record", async () => {
    const now = new Date("2026-05-08T12:00:00Z");
    const { svc, repo } = makeService(now);
    const older = await svc.create({ ...baseInput, title: "older" });
    const newer = await svc.create({ ...baseInput, title: "newer" });
    repo.setCreatedAt(older._id, new Date("2026-05-01T00:00:00Z"));
    repo.setCreatedAt(newer._id, new Date("2026-05-07T00:00:00Z"));
    const active = await svc.getActive();
    expect(active?.id).toBe(newer._id);
    expect(active?.title).toBe("newer");
  });

  it("getActive ignores disabled records", async () => {
    const { svc } = makeService();
    await svc.create({ ...baseInput, enabled: false });
    expect(await svc.getActive()).toBeNull();
  });

  it("getActive respects startsAt lower bound", async () => {
    const now = new Date("2026-05-08T12:00:00Z");
    const { svc } = makeService(now);
    await svc.create({
      ...baseInput,
      startsAt: new Date("2026-06-01T00:00:00Z"),
    });
    expect(await svc.getActive()).toBeNull();
  });

  it("getActive respects endsAt upper bound (exclusive)", async () => {
    const now = new Date("2026-05-08T12:00:00Z");
    const { svc } = makeService(now);
    await svc.create({
      ...baseInput,
      endsAt: new Date("2026-05-08T12:00:00Z"),
    });
    expect(await svc.getActive()).toBeNull();
  });

  it("getActive returns the public projection (no createdBy / dates)", async () => {
    const { svc } = makeService();
    await svc.create({
      ...baseInput,
      ctaLabel: "Read more",
      ctaUrl: "https://ornn.dev/news",
    });
    const active = await svc.getActive();
    expect(active).toEqual({
      id: expect.any(String),
      title: "Hello",
      bodyMarkdown: "World",
      ctaLabel: "Read more",
      ctaUrl: "https://ornn.dev/news",
    });
  });

  it("create rejects inverted [startsAt, endsAt] windows", async () => {
    const { svc } = makeService();
    await expect(
      svc.create({
        ...baseInput,
        startsAt: new Date("2026-06-01T00:00:00Z"),
        endsAt: new Date("2026-05-01T00:00:00Z"),
      }),
    ).rejects.toThrow(/endsAt must be strictly after startsAt/);
  });

  it("update merges window bounds before validating order", async () => {
    const { svc } = makeService();
    const created = await svc.create({
      ...baseInput,
      startsAt: new Date("2026-05-01T00:00:00Z"),
      endsAt: new Date("2026-06-01T00:00:00Z"),
    });
    // Patching only endsAt to before existing startsAt must fail.
    await expect(
      svc.update(created._id, { endsAt: new Date("2026-04-15T00:00:00Z") }),
    ).rejects.toThrow(/endsAt must be strictly after startsAt/);
  });

  it("update on missing id throws ANNOUNCEMENT_NOT_FOUND", async () => {
    const { svc } = makeService();
    await expect(svc.update("does-not-exist", { enabled: false })).rejects.toThrow(
      /Announcement not found/,
    );
  });

  it("delete on missing id throws ANNOUNCEMENT_NOT_FOUND", async () => {
    const { svc } = makeService();
    await expect(svc.delete("does-not-exist")).rejects.toThrow(/Announcement not found/);
  });
});
