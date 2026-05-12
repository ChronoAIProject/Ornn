/**
 * QuotaService unit tests — UT-QUOTA-001..023 from Testing.md.
 *
 * Uses an in-memory fake repository so the service layer is exercised
 * without a real Mongo. Atomicity / index behavior is covered by
 * `repository.test.ts` against `mongodb-memory-server`.
 *
 * @module domains/quota/service.test
 */

import { describe, expect, test } from "bun:test";
import { QuotaService, type QuotaDefaults } from "./service";
import {
  type QuotaBucketDoc,
  type QuotaGrantAuditDoc,
  type Surface,
  bucketId,
  monthBounds,
} from "./types";

class FakeRepo {
  buckets = new Map<string, QuotaBucketDoc>();
  audit: QuotaGrantAuditDoc[] = [];

  async findBucket(userId: string, surface: Surface, monthMarker: string) {
    return this.buckets.get(bucketId(userId, surface, monthMarker)) ?? null;
  }

  async findLifetime(userId: string, surface: Surface) {
    return [...this.buckets.values()]
      .filter((b) => b.userId === userId && b.surface === surface)
      .sort((a, b) => a.monthMarker.localeCompare(b.monthMarker));
  }

  async incrementUsed(p: {
    userId: string;
    surface: Surface;
    modelId: string | null | undefined;
    defaultAllotment: number;
    now?: Date;
  }) {
    const now = p.now ?? new Date();
    const { monthMarker, monthStart, monthEnd } = monthBounds(now);
    const id = bucketId(p.userId, p.surface, monthMarker);
    const existing = this.buckets.get(id);
    const modelKey = p.modelId && p.modelId.length > 0 ? p.modelId : "__unknown__";
    const next: QuotaBucketDoc = existing
      ? {
          ...existing,
          used: existing.used + 1,
          usedByModel: {
            ...existing.usedByModel,
            [modelKey]: (existing.usedByModel[modelKey] ?? 0) + 1,
          },
          updatedAt: now,
        }
      : {
          _id: id,
          userId: p.userId,
          surface: p.surface,
          monthMarker,
          monthStart,
          monthEnd,
          defaultAllotment: p.defaultAllotment,
          adminGrant: 0,
          used: 1,
          usedByModel: { [modelKey]: 1 },
          createdAt: now,
          updatedAt: now,
        };
    this.buckets.set(id, next);
    return next;
  }

  async incrementAdminGrant(p: {
    userId: string;
    surface: Surface;
    amount: number;
    defaultAllotment: number;
    now?: Date;
  }) {
    const now = p.now ?? new Date();
    const { monthMarker, monthStart, monthEnd } = monthBounds(now);
    const id = bucketId(p.userId, p.surface, monthMarker);
    const existing = this.buckets.get(id);
    const next: QuotaBucketDoc = existing
      ? { ...existing, adminGrant: existing.adminGrant + p.amount, updatedAt: now }
      : {
          _id: id,
          userId: p.userId,
          surface: p.surface,
          monthMarker,
          monthStart,
          monthEnd,
          defaultAllotment: p.defaultAllotment,
          adminGrant: p.amount,
          used: 0,
          usedByModel: {},
          createdAt: now,
          updatedAt: now,
        };
    this.buckets.set(id, next);
    return next;
  }

  async appendGrantAudit(row: Omit<QuotaGrantAuditDoc, "_id">) {
    const _id = `audit-${this.audit.length}`;
    this.audit.push({ _id, ...row });
    return _id;
  }

  async listGrantAudit(p: {
    page: number;
    pageSize: number;
    targetUserId?: string;
    adminUserId?: string;
  }) {
    let rows = [...this.audit];
    if (p.targetUserId) rows = rows.filter((r) => r.targetUserId === p.targetUserId);
    if (p.adminUserId) rows = rows.filter((r) => r.adminUserId === p.adminUserId);
    rows.sort((a, b) => +b.createdAt - +a.createdAt);
    const offset = (p.page - 1) * p.pageSize;
    return { items: rows.slice(offset, offset + p.pageSize), total: rows.length };
  }
}

class FakeDefaults implements QuotaDefaults {
  defaultPlaygroundMonthly = 100;
  defaultSkillGenMonthly = 10;
  async getQuotaDefaults() {
    return {
      defaultPlaygroundMonthly: this.defaultPlaygroundMonthly,
      defaultSkillGenMonthly: this.defaultSkillGenMonthly,
    };
  }
}

const ADMIN_PERM = "ornn:admin:skill";

function build(opts: { defaultPg?: number; defaultSg?: number } = {}) {
  const repo = new FakeRepo();
  const defaults = new FakeDefaults();
  if (opts.defaultPg !== undefined) defaults.defaultPlaygroundMonthly = opts.defaultPg;
  if (opts.defaultSg !== undefined) defaults.defaultSkillGenMonthly = opts.defaultSg;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new QuotaService({ repo: repo as any, defaults });
  return { repo, defaults, service };
}

describe("UT-QUOTA-001 admin permission bypass", () => {
  test("checkAllowed → admin bypass; chargeOnCompletion is no-op", async () => {
    const { service, repo } = build();
    const decision = await service.checkAllowed({
      userId: "u1",
      permissions: [ADMIN_PERM],
      surface: "playground",
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.isAdminBypass).toBe(true);

    await service.chargeOnCompletion({
      userId: "u1",
      permissions: [ADMIN_PERM],
      surface: "playground",
      outcome: "success",
    });
    expect(repo.buckets.size).toBe(0);
  });
});

describe("UT-QUOTA-002 first-call shows clean snapshot", () => {
  test("snapshot returns 0/100 for fresh user", async () => {
    const { service } = build();
    const snap = await service.getSnapshot({ userId: "u1", permissions: [] });
    expect(snap.playground.used).toBe(0);
    expect(snap.playground.defaultAllotment).toBe(100);
    expect(snap.playground.adminGrant).toBe(0);
    expect(snap.playground.remaining).toBe(100);
    expect(snap.monthMarker).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("UT-QUOTA-003 allowed when under cap", () => {
  test("used < default+grant → allowed", async () => {
    const { service, repo } = build();
    const now = new Date(Date.UTC(2026, 4, 15));
    repo.buckets.set("u1:playground:2026-05", {
      _id: "u1:playground:2026-05",
      userId: "u1",
      surface: "playground",
      monthMarker: "2026-05",
      monthStart: new Date(Date.UTC(2026, 4, 1)),
      monthEnd: new Date(Date.UTC(2026, 5, 1)),
      defaultAllotment: 100,
      adminGrant: 0,
      used: 50,
      usedByModel: {},
      createdAt: now,
      updatedAt: now,
    });
    const d = await service.checkAllowed({
      userId: "u1",
      permissions: [],
      surface: "playground",
      now,
    });
    expect(d.allowed).toBe(true);
  });
});

describe("UT-QUOTA-004 blocked when at cap", () => {
  test("used == default+grant → 429", async () => {
    const { service, repo } = build();
    const now = new Date(Date.UTC(2026, 4, 15));
    repo.buckets.set("u1:playground:2026-05", {
      _id: "u1:playground:2026-05",
      userId: "u1",
      surface: "playground",
      monthMarker: "2026-05",
      monthStart: new Date(Date.UTC(2026, 4, 1)),
      monthEnd: new Date(Date.UTC(2026, 5, 1)),
      defaultAllotment: 100,
      adminGrant: 0,
      used: 100,
      usedByModel: {},
      createdAt: now,
      updatedAt: now,
    });
    const d = await service.checkAllowed({
      userId: "u1",
      permissions: [],
      surface: "playground",
      now,
    });
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.message).toContain("playground");
  });
});

describe("UT-QUOTA-005 admin grant lifts ceiling", () => {
  test("used==default but adminGrant>0 → allowed", async () => {
    const { service, repo } = build();
    const now = new Date(Date.UTC(2026, 4, 15));
    repo.buckets.set("u1:playground:2026-05", {
      _id: "u1:playground:2026-05",
      userId: "u1",
      surface: "playground",
      monthMarker: "2026-05",
      monthStart: new Date(Date.UTC(2026, 4, 1)),
      monthEnd: new Date(Date.UTC(2026, 5, 1)),
      defaultAllotment: 100,
      adminGrant: 5,
      used: 100,
      usedByModel: {},
      createdAt: now,
      updatedAt: now,
    });
    const d = await service.checkAllowed({
      userId: "u1",
      permissions: [],
      surface: "playground",
      now,
    });
    expect(d.allowed).toBe(true);
  });
});

describe("UT-QUOTA-006 charge success increments used+usedByModel", () => {
  test("used+=1 and usedByModel.<id>+=1", async () => {
    const { service, repo } = build();
    const now = new Date(Date.UTC(2026, 4, 15));
    await service.chargeOnCompletion({
      userId: "u1",
      permissions: [],
      surface: "playground",
      outcome: "success",
      modelId: "gpt-4o",
      now,
    });
    const b = repo.buckets.get("u1:playground:2026-05");
    expect(b?.used).toBe(1);
    expect(b?.usedByModel["gpt-4o"]).toBe(1);
  });
});

describe("UT-QUOTA-007 skill_error charges 1", () => {
  test("used+=1 on skill_error", async () => {
    const { service, repo } = build();
    await service.chargeOnCompletion({
      userId: "u1",
      permissions: [],
      surface: "playground",
      outcome: "skill_error",
    });
    expect([...repo.buckets.values()][0]?.used).toBe(1);
  });
});

describe("UT-QUOTA-008 system_error charges 0", () => {
  test("DB unchanged on system_error", async () => {
    const { service, repo } = build();
    await service.chargeOnCompletion({
      userId: "u1",
      permissions: [],
      surface: "playground",
      outcome: "system_error",
    });
    expect(repo.buckets.size).toBe(0);
  });
});

describe("UT-QUOTA-009 unknown modelId routes to __unknown__", () => {
  test("missing modelId → usedByModel.__unknown__: 1", async () => {
    const { service, repo } = build();
    await service.chargeOnCompletion({
      userId: "u1",
      permissions: [],
      surface: "playground",
      outcome: "success",
    });
    expect([...repo.buckets.values()][0]?.usedByModel["__unknown__"]).toBe(1);
  });
});

describe("UT-QUOTA-011 boundary millisecond rollover", () => {
  test("Jun 1 00:00:00.000Z creates new June bucket; May untouched", async () => {
    const { service, repo } = build();
    const may = new Date(Date.UTC(2026, 4, 31, 23, 59, 59, 999));
    await service.chargeOnCompletion({
      userId: "u1",
      permissions: [],
      surface: "playground",
      outcome: "success",
      now: may,
    });
    const jun = new Date(Date.UTC(2026, 5, 1, 0, 0, 0, 0));
    await service.chargeOnCompletion({
      userId: "u1",
      permissions: [],
      surface: "playground",
      outcome: "success",
      now: jun,
    });
    const mayBucket = repo.buckets.get("u1:playground:2026-05");
    const junBucket = repo.buckets.get("u1:playground:2026-06");
    expect(mayBucket?.used).toBe(1);
    expect(junBucket?.used).toBe(1);
  });
});

describe("UT-QUOTA-012 last millisecond of May → 2026-05", () => {
  test("monthMarker stays May at 23:59:59.999", async () => {
    const { service, repo } = build();
    const may = new Date(Date.UTC(2026, 4, 31, 23, 59, 59, 999));
    await service.chargeOnCompletion({
      userId: "u1",
      permissions: [],
      surface: "playground",
      outcome: "success",
      now: may,
    });
    expect(repo.buckets.has("u1:playground:2026-05")).toBe(true);
  });
});

describe("UT-QUOTA-013 default raise mid-month grants headroom", () => {
  test("effectiveDefault = max(stored, current); raise lifts cap", async () => {
    const { service, defaults, repo } = build({ defaultPg: 100 });
    const now = new Date(Date.UTC(2026, 4, 15));
    // Bucket stored at default 100, used 100 (at cap).
    repo.buckets.set("u1:playground:2026-05", {
      _id: "u1:playground:2026-05",
      userId: "u1",
      surface: "playground",
      monthMarker: "2026-05",
      monthStart: new Date(Date.UTC(2026, 4, 1)),
      monthEnd: new Date(Date.UTC(2026, 5, 1)),
      defaultAllotment: 100,
      adminGrant: 0,
      used: 100,
      usedByModel: {},
      createdAt: now,
      updatedAt: now,
    });
    // Admin raises default to 150 — user should now be allowed again.
    defaults.defaultPlaygroundMonthly = 150;
    const d = await service.checkAllowed({
      userId: "u1",
      permissions: [],
      surface: "playground",
      now,
    });
    expect(d.allowed).toBe(true);
  });
});

describe("UT-QUOTA-014 default lower floors at 0; used unchanged", () => {
  test("lowering default does not retroactively shrink used", async () => {
    const { service, defaults, repo } = build({ defaultPg: 100 });
    const now = new Date(Date.UTC(2026, 4, 15));
    repo.buckets.set("u1:playground:2026-05", {
      _id: "u1:playground:2026-05",
      userId: "u1",
      surface: "playground",
      monthMarker: "2026-05",
      monthStart: new Date(Date.UTC(2026, 4, 1)),
      monthEnd: new Date(Date.UTC(2026, 5, 1)),
      defaultAllotment: 100,
      adminGrant: 0,
      used: 100,
      usedByModel: {},
      createdAt: now,
      updatedAt: now,
    });
    defaults.defaultPlaygroundMonthly = 50;
    const snap = await service.getSnapshot({ userId: "u1", permissions: [], now });
    // effectiveDefault = max(100, 50) = 100; used unchanged.
    expect(snap.playground.used).toBe(100);
    expect(snap.playground.remaining).toBe(0);
    const d = await service.checkAllowed({
      userId: "u1",
      permissions: [],
      surface: "playground",
      now,
    });
    expect(d.allowed).toBe(false);
  });
});

describe("UT-QUOTA-015 grants accumulate", () => {
  test("two grants stack adminGrant", async () => {
    const { service, repo } = build();
    const admin = { userId: "a1", email: "a@x", displayName: "A" };
    await service.grant({ admin, targetUserId: "u1", surface: "playground", amount: 5 });
    await service.grant({ admin, targetUserId: "u1", surface: "playground", amount: 3 });
    const b = [...repo.buckets.values()].find((x) => x.userId === "u1");
    expect(b?.adminGrant).toBe(8);
  });
});

describe("UT-QUOTA-016 grant ≤100k accepted", () => {
  test("amount=100000 is valid", async () => {
    const { service } = build();
    const admin = { userId: "a1", email: "a@x", displayName: "A" };
    const r = await service.grant({
      admin,
      targetUserId: "u1",
      surface: "playground",
      amount: 100_000,
    });
    expect(r.newAdminGrant).toBe(100_000);
  });
});

describe("UT-QUOTA-017 grant >100k rejected", () => {
  test("amount=100001 throws before DB", async () => {
    const { service, repo } = build();
    const admin = { userId: "a1", email: "a@x", displayName: "A" };
    await expect(
      service.grant({
        admin,
        targetUserId: "u1",
        surface: "playground",
        amount: 100_001,
      }),
    ).rejects.toThrow();
    expect(repo.buckets.size).toBe(0);
  });
});

describe("UT-QUOTA-018 grant ≤0 rejected", () => {
  test("amount=0 and amount=-1 throw", async () => {
    const { service } = build();
    const admin = { userId: "a1", email: "a@x", displayName: "A" };
    await expect(
      service.grant({ admin, targetUserId: "u1", surface: "playground", amount: 0 }),
    ).rejects.toThrow();
    await expect(
      service.grant({ admin, targetUserId: "u1", surface: "playground", amount: -1 }),
    ).rejects.toThrow();
  });
});

describe("UT-QUOTA-019 grant disappears at rollover", () => {
  test("May grant; June bucket starts fresh", async () => {
    const { service, repo } = build();
    const admin = { userId: "a1", email: "a@x", displayName: "A" };
    const may = new Date(Date.UTC(2026, 4, 15));
    await service.grant({
      admin,
      targetUserId: "u1",
      surface: "playground",
      amount: 5,
      now: may,
    });
    expect(repo.buckets.get("u1:playground:2026-05")?.adminGrant).toBe(5);

    // Advance to June: snapshot should show 0 grant.
    const jun = new Date(Date.UTC(2026, 5, 15));
    const snap = await service.getSnapshot({ userId: "u1", permissions: [], now: jun });
    expect(snap.playground.adminGrant).toBe(0);
    expect(snap.playground.used).toBe(0);
  });
});

describe("UT-QUOTA-020 nextMonthlyResetAt correct", () => {
  test("snapshot exposes ISO of next month boundary", async () => {
    const { service } = build();
    const now = new Date(Date.UTC(2026, 4, 15));
    const snap = await service.getSnapshot({ userId: "u1", permissions: [], now });
    expect(snap.nextMonthlyResetAt).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("UT-QUOTA-021 snapshot has no daily/expiresAt", () => {
  test("exact key set on /me/quota body", async () => {
    const { service } = build();
    const snap = await service.getSnapshot({ userId: "u1", permissions: [] });
    const surfaceKeys = Object.keys(snap.playground).sort();
    expect(surfaceKeys).toEqual([
      "adminGrant",
      "defaultAllotment",
      "remaining",
      "used",
      "warning",
      "warningThreshold",
    ]);
    // Ensure nothing daily-shaped leaks through.
    expect("daily" in snap.playground).toBe(false);
    expect("dailyUsed" in snap.playground).toBe(false);
    expect("dailyResetAt" in snap.playground).toBe(false);
  });
});

describe("UT-QUOTA-023 year boundary rollover", () => {
  test("Dec 31 23:59:59.999Z → 2026; Jan 1 00:00Z → 2027", async () => {
    const { service, repo } = build();
    const dec = new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999));
    await service.chargeOnCompletion({
      userId: "u1",
      permissions: [],
      surface: "playground",
      outcome: "success",
      now: dec,
    });
    const jan = new Date(Date.UTC(2027, 0, 1, 0, 0, 0, 0));
    await service.chargeOnCompletion({
      userId: "u1",
      permissions: [],
      surface: "playground",
      outcome: "success",
      now: jan,
    });
    expect(repo.buckets.has("u1:playground:2026-12")).toBe(true);
    expect(repo.buckets.has("u1:playground:2027-01")).toBe(true);
  });
});

describe("bulk grant aggregates results", () => {
  test("3 ids → 3 success rows", async () => {
    const { service } = build();
    const admin = { userId: "a1", email: "a@x", displayName: "A" };
    const r = await service.bulkGrant({
      admin,
      targetUserIds: ["u1", "u2", "u3"],
      surface: "playground",
      amount: 5,
    });
    expect(r.length).toBe(3);
    expect(r.every((x) => x.ok)).toBe(true);
  });
});
