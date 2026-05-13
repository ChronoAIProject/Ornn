/**
 * AnnouncementService unit tests against an in-memory repository fake.
 *
 * Covers:
 *   - getActive() picks the most recent record matching enabled + window.
 *   - Disabled records and out-of-window records are filtered out.
 *   - create/update reject inverted [startsAt, endsAt] windows.
 *   - update on a missing id surfaces a 404 AppError.
 *   - Bilingual fields (en + zh) round-trip through create/getActive/
 *     listPublished without locale-side mutation.
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

  async findAllReleased(now: Date): Promise<AnnouncementDocument[]> {
    return [...this.rows.values()]
      .filter(
        (d) =>
          d.enabled && (d.startsAt === null || d.startsAt.getTime() <= now.getTime()),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async update(
    id: string,
    patch: UpdateAnnouncementInput,
  ): Promise<AnnouncementDocument | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const next: AnnouncementDocument = {
      ...existing,
      titleEn: patch.titleEn !== undefined ? patch.titleEn : existing.titleEn,
      titleZh: patch.titleZh !== undefined ? patch.titleZh : existing.titleZh,
      bodyMarkdownEn:
        patch.bodyMarkdownEn !== undefined
          ? patch.bodyMarkdownEn
          : existing.bodyMarkdownEn,
      bodyMarkdownZh:
        patch.bodyMarkdownZh !== undefined
          ? patch.bodyMarkdownZh
          : existing.bodyMarkdownZh,
      ctaLabelEn:
        patch.ctaLabelEn !== undefined ? patch.ctaLabelEn : existing.ctaLabelEn,
      ctaLabelZh:
        patch.ctaLabelZh !== undefined ? patch.ctaLabelZh : existing.ctaLabelZh,
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
  titleEn: "Hello",
  titleZh: "",
  bodyMarkdownEn: "World",
  bodyMarkdownZh: "",
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
    const older = await svc.create({ ...baseInput, titleEn: "older" });
    const newer = await svc.create({ ...baseInput, titleEn: "newer" });
    repo.setCreatedAt(older._id, new Date("2026-05-01T00:00:00Z"));
    repo.setCreatedAt(newer._id, new Date("2026-05-07T00:00:00Z"));
    const active = await svc.getActive();
    expect(active?.id).toBe(newer._id);
    expect(active?.titleEn).toBe("newer");
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
      ctaLabelEn: "Read more",
      ctaLabelZh: "了解更多",
      ctaUrl: "https://ornn.dev/news",
    });
    const active = await svc.getActive();
    expect(active).toEqual({
      id: expect.any(String),
      titleEn: "Hello",
      titleZh: "",
      bodyMarkdownEn: "World",
      bodyMarkdownZh: "",
      ctaLabelEn: "Read more",
      ctaLabelZh: "了解更多",
      ctaUrl: "https://ornn.dev/news",
    });
  });

  it("getActive surfaces zh content when admin filled both locales", async () => {
    const { svc } = makeService();
    await svc.create({
      ...baseInput,
      titleEn: "Welcome",
      titleZh: "欢迎",
      bodyMarkdownEn: "## Hello",
      bodyMarkdownZh: "## 你好",
    });
    const active = await svc.getActive();
    expect(active?.titleEn).toBe("Welcome");
    expect(active?.titleZh).toBe("欢迎");
    expect(active?.bodyMarkdownEn).toBe("## Hello");
    expect(active?.bodyMarkdownZh).toBe("## 你好");
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

  // ---- listPublished (#357 News page) ------------------------------------

  it("listPublished returns released announcements newest first", async () => {
    const now = new Date("2026-05-08T12:00:00Z");
    const { svc, repo } = makeService(now);
    const a = await svc.create({ ...baseInput, titleEn: "a" });
    const b = await svc.create({ ...baseInput, titleEn: "b" });
    const c = await svc.create({ ...baseInput, titleEn: "c" });
    repo.setCreatedAt(a._id, new Date("2026-05-01T00:00:00Z"));
    repo.setCreatedAt(b._id, new Date("2026-05-05T00:00:00Z"));
    repo.setCreatedAt(c._id, new Date("2026-05-07T00:00:00Z"));
    const items = await svc.listPublished();
    expect(items.map((i) => i.titleEn)).toEqual(["c", "b", "a"]);
  });

  it("listPublished excludes disabled records", async () => {
    const { svc } = makeService();
    await svc.create({ ...baseInput, titleEn: "hidden", enabled: false });
    await svc.create({ ...baseInput, titleEn: "shown" });
    const items = await svc.listPublished();
    expect(items.map((i) => i.titleEn)).toEqual(["shown"]);
  });

  it("listPublished excludes future-scheduled records (startsAt > now)", async () => {
    const now = new Date("2026-05-08T12:00:00Z");
    const { svc } = makeService(now);
    await svc.create({
      ...baseInput,
      titleEn: "future",
      startsAt: new Date("2026-06-01T00:00:00Z"),
    });
    await svc.create({ ...baseInput, titleEn: "today" });
    const items = await svc.listPublished();
    expect(items.map((i) => i.titleEn)).toEqual(["today"]);
  });

  it("listPublished INCLUDES expired records (endsAt < now) — archive", async () => {
    const now = new Date("2026-05-08T12:00:00Z");
    const { svc } = makeService(now);
    await svc.create({
      ...baseInput,
      titleEn: "expired",
      startsAt: new Date("2026-04-01T00:00:00Z"),
      endsAt: new Date("2026-04-15T00:00:00Z"),
    });
    const items = await svc.listPublished();
    expect(items.map((i) => i.titleEn)).toEqual(["expired"]);
  });

  it("listPublished projects publishedAt = startsAt when set, else createdAt", async () => {
    const now = new Date("2026-05-08T12:00:00Z");
    const { svc, repo } = makeService(now);
    const scheduled = await svc.create({
      ...baseInput,
      titleEn: "scheduled",
      startsAt: new Date("2026-05-01T00:00:00Z"),
    });
    const adhoc = await svc.create({ ...baseInput, titleEn: "adhoc" });
    repo.setCreatedAt(adhoc._id, new Date("2026-05-03T00:00:00Z"));
    // Force ordering: scheduled.createdAt newer so it sorts first
    repo.setCreatedAt(scheduled._id, new Date("2026-05-04T00:00:00Z"));
    const items = await svc.listPublished();
    expect(items[0]?.publishedAt).toBe("2026-05-01T00:00:00.000Z"); // startsAt wins
    expect(items[1]?.publishedAt).toBe("2026-05-03T00:00:00.000Z"); // createdAt fallback
  });

  it("listPublished projects the public shape (no createdBy / enabled / endsAt)", async () => {
    const { svc } = makeService();
    await svc.create({
      ...baseInput,
      ctaLabelEn: "Read more",
      ctaLabelZh: "",
      ctaUrl: "https://ornn.dev/news",
    });
    const items = await svc.listPublished();
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: expect.any(String),
      titleEn: "Hello",
      titleZh: "",
      bodyMarkdownEn: "World",
      bodyMarkdownZh: "",
      ctaLabelEn: "Read more",
      ctaLabelZh: "",
      ctaUrl: "https://ornn.dev/news",
      publishedAt: expect.stringMatching(/\d{4}-\d{2}-\d{2}T/),
    });
  });
});
