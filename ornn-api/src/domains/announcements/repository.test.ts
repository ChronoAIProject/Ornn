/**
 * AnnouncementRepository unit tests (#454).
 *
 * Single-active model. Two read paths:
 *   - findActive: the popup — most recent enabled record currently in
 *     its [startsAt, endsAt] window.
 *   - findAllReleased: the News archive — every enabled record whose
 *     start gate has elapsed, newest first. Past records are kept.
 *
 * Tolerates legacy single-locale documents (raw `title`/`bodyMarkdown`)
 * during the bilingual rollout window, so the repo mapper has its own
 * test surface.
 *
 * @module domains/announcements/repository.test
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { MongoClient, type Db, type Document } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AnnouncementRepository, type CreateAnnouncementInput } from "./repository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: AnnouncementRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("announcements_test");
  repo = new AnnouncementRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("announcements").deleteMany({});
});

function mkInput(overrides: Partial<CreateAnnouncementInput> = {}): CreateAnnouncementInput {
  return {
    titleEn: "Hello",
    titleZh: "你好",
    bodyMarkdownEn: "# Body",
    bodyMarkdownZh: "# 正文",
    ctaLabelEn: null,
    ctaLabelZh: null,
    ctaUrl: null,
    enabled: true,
    startsAt: null,
    endsAt: null,
    createdBy: "admin-1",
    ...overrides,
  };
}

describe("create", () => {
  test("inserts and returns the mapped document", async () => {
    const doc = await repo.create(mkInput());
    expect(doc._id).toBeDefined();
    expect(doc.titleEn).toBe("Hello");
    expect(doc.titleZh).toBe("你好");
    expect(doc.enabled).toBe(true);
    expect(doc.createdBy).toBe("admin-1");
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.updatedAt).toBeInstanceOf(Date);
  });

  test("nullable CTA + schedule fields default to null", async () => {
    const doc = await repo.create(mkInput());
    expect(doc.ctaLabelEn).toBeNull();
    expect(doc.ctaLabelZh).toBeNull();
    expect(doc.ctaUrl).toBeNull();
    expect(doc.startsAt).toBeNull();
    expect(doc.endsAt).toBeNull();
  });
});

describe("listAll + findById", () => {
  test("listAll returns every record, newest first", async () => {
    await repo.create(mkInput({ titleEn: "First" }));
    await new Promise((r) => setTimeout(r, 5));
    await repo.create(mkInput({ titleEn: "Second" }));
    await new Promise((r) => setTimeout(r, 5));
    await repo.create(mkInput({ titleEn: "Third" }));
    const rows = await repo.listAll();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.titleEn).toBe("Third");
    expect(rows[2]?.titleEn).toBe("First");
  });

  test("findById returns the matching doc or null", async () => {
    const created = await repo.create(mkInput());
    const found = await repo.findById(created._id);
    expect(found?._id).toBe(created._id);
    const missing = await repo.findById("does-not-exist");
    expect(missing).toBeNull();
  });
});

describe("findActive", () => {
  test("returns the most recent enabled record in-window", async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    await repo.create(mkInput({ titleEn: "Old", startsAt: past, endsAt: future }));
    await new Promise((r) => setTimeout(r, 5));
    await repo.create(mkInput({ titleEn: "Newer", startsAt: past, endsAt: future }));
    const active = await repo.findActive(new Date());
    expect(active?.titleEn).toBe("Newer");
  });

  test("ignores disabled records", async () => {
    await repo.create(mkInput({ titleEn: "Off", enabled: false }));
    const active = await repo.findActive(new Date());
    expect(active).toBeNull();
  });

  test("ignores records before startsAt", async () => {
    const future = new Date(Date.now() + 60_000);
    await repo.create(mkInput({ titleEn: "Not yet", startsAt: future, endsAt: null }));
    const active = await repo.findActive(new Date());
    expect(active).toBeNull();
  });

  test("ignores records after endsAt", async () => {
    const past = new Date(Date.now() - 60_000);
    await repo.create(mkInput({ titleEn: "Expired", startsAt: null, endsAt: past }));
    const active = await repo.findActive(new Date());
    expect(active).toBeNull();
  });

  test("null bounds mean open-ended on that side", async () => {
    await repo.create(mkInput({ titleEn: "Always", startsAt: null, endsAt: null }));
    const active = await repo.findActive(new Date());
    expect(active?.titleEn).toBe("Always");
  });
});

describe("findAllReleased", () => {
  test("returns every enabled record whose startsAt has elapsed (incl. expired)", async () => {
    const past = new Date(Date.now() - 60_000);
    const pastEnd = new Date(Date.now() - 30_000);
    const future = new Date(Date.now() + 60_000);
    // Released + still in window
    await repo.create(mkInput({ titleEn: "Live", startsAt: past, endsAt: future }));
    // Released + expired — News page retains this
    await new Promise((r) => setTimeout(r, 5));
    await repo.create(mkInput({ titleEn: "Archived", startsAt: past, endsAt: pastEnd }));
    // Not yet released — excluded
    await new Promise((r) => setTimeout(r, 5));
    await repo.create(mkInput({ titleEn: "Future", startsAt: future, endsAt: null }));
    // Disabled — excluded
    await new Promise((r) => setTimeout(r, 5));
    await repo.create(mkInput({ titleEn: "Off", enabled: false }));

    const rows = await repo.findAllReleased(new Date());
    expect(rows.map((r) => r.titleEn).sort()).toEqual(["Archived", "Live"]);
  });
});

describe("update", () => {
  test("patches specified fields and bumps updatedAt", async () => {
    const created = await repo.create(mkInput({ titleEn: "Old" }));
    const oldUpdatedAt = created.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    const patched = await repo.update(created._id, { titleEn: "New" });
    expect(patched?.titleEn).toBe("New");
    expect(patched?.titleZh).toBe("你好"); // untouched
    expect((patched?.updatedAt.getTime() ?? 0)).toBeGreaterThan(oldUpdatedAt);
  });

  test("can clear nullable fields (set to null)", async () => {
    const created = await repo.create(
      mkInput({ ctaLabelEn: "Click", ctaLabelZh: "点击", ctaUrl: "https://x" }),
    );
    const patched = await repo.update(created._id, {
      ctaLabelEn: null,
      ctaLabelZh: null,
      ctaUrl: null,
    });
    expect(patched?.ctaLabelEn).toBeNull();
    expect(patched?.ctaLabelZh).toBeNull();
    expect(patched?.ctaUrl).toBeNull();
  });

  test("returns null when id doesn't exist (no insert)", async () => {
    const res = await repo.update("does-not-exist", { titleEn: "X" });
    expect(res).toBeNull();
    const count = await db.collection("announcements").countDocuments();
    expect(count).toBe(0);
  });
});

describe("delete", () => {
  test("removes a record and reports success", async () => {
    const created = await repo.create(mkInput());
    const ok = await repo.delete(created._id);
    expect(ok).toBe(true);
    expect(await repo.findById(created._id)).toBeNull();
  });

  test("returns false when id doesn't exist", async () => {
    const ok = await repo.delete("does-not-exist");
    expect(ok).toBe(false);
  });
});

describe("legacy single-locale tolerance (mapper)", () => {
  test("backfills *En / *Zh from legacy `title` / `bodyMarkdown` / `ctaLabel` columns", async () => {
    // Old shape, pre-bilingual rollout. Repo MUST surface the legacy
    // text on both locale slots so the public surface keeps rendering
    // until the boot migration's first pass.
    const legacyDoc: Document = {
      _id: "legacy-1",
      title: "Legacy Title",
      bodyMarkdown: "Legacy body",
      ctaLabel: "Legacy CTA",
      ctaUrl: "https://x",
      enabled: true,
      startsAt: null,
      endsAt: null,
      createdBy: "admin-legacy",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection("announcements").insertOne(legacyDoc);
    const found = await repo.findById("legacy-1");
    expect(found?.titleEn).toBe("Legacy Title");
    expect(found?.titleZh).toBe("Legacy Title");
    expect(found?.bodyMarkdownEn).toBe("Legacy body");
    expect(found?.bodyMarkdownZh).toBe("Legacy body");
    expect(found?.ctaLabelEn).toBe("Legacy CTA");
    expect(found?.ctaLabelZh).toBe("Legacy CTA");
  });
});
