/**
 * Tests for #724: LaunchPromoService.awardUser orchestrates the
 * eligibility gate, redemption-code mint, notification drop, and
 * claim insert as one atomic-ish unit. Cover the happy path + every
 * service-level error sentinel so the route layer's HTTP mapping
 * stays correct.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { LaunchPromoService, LAUNCH_PROMO_ERROR_PREFIXES } from "./service";
import type { LaunchPromoClaimDoc } from "./types";
import type { LaunchPromoRepository } from "./repository";
import type { UserDirectoryRepository } from "../users/repository";
import type { SettingsService } from "../settings/types";
import type { LaunchPromoSection } from "../settings/sections";
import type { RedemptionCodeService } from "../redemption-codes/service";
import type { NotificationRepository } from "../notifications/repository";

const DEFAULT_SECTION: LaunchPromoSection = {
  enabled: true,
  repoOwner: "ChronoAIProject",
  repoName: "Ornn",
  totalSlots: 500,
  awardPlayground: 200,
  awardSkillGen: 200,
  pollIntervalMs: 600_000,
  codeExpiryDays: 90,
  nyxidInviteCode: "NYX-TEST-123",
};

function makeService(opts: {
  section?: Partial<LaunchPromoSection>;
  hasClaimed?: boolean;
  rank?: number | null;
  awarded?: number;
  mintShouldFail?: boolean;
  insertShouldFail?: "duplicate" | "other" | undefined;
}): {
  service: LaunchPromoService;
  claims: LaunchPromoClaimDoc[];
  notifications: Array<{ userId: string; title: string }>;
  mintCalls: Array<{ grants: unknown }>;
} {
  const merged: LaunchPromoSection = { ...DEFAULT_SECTION, ...(opts.section ?? {}) };
  const claims: LaunchPromoClaimDoc[] = [];
  const notifications: Array<{ userId: string; title: string }> = [];
  const mintCalls: Array<{ grants: unknown }> = [];

  const repo: LaunchPromoRepository = {
    ensureIndexes: async () => {},
    hasClaimed: async () => opts.hasClaimed ?? false,
    findByUserId: async (id: string) => claims.find((c) => c._id === id) ?? null,
    insert: async (doc: LaunchPromoClaimDoc) => {
      if (opts.insertShouldFail === "duplicate") {
        const err: Error & { code?: number } = new Error("dup");
        err.code = 11000;
        throw err;
      }
      if (opts.insertShouldFail === "other") {
        throw new Error("mongo died");
      }
      claims.push(doc);
    },
    countAwarded: async () => opts.awarded ?? 0,
    listRecent: async () => claims.slice(),
  } as unknown as LaunchPromoRepository;

  // `??` collapses both `undefined` and `null` to the default, but the
  // null case is meaningful here (user not in directory). Use an
  // explicit-key check so `rank: null` propagates as null.
  const rankValue: number | null = "rank" in opts ? (opts.rank ?? null) : 42;
  const userDirectoryRepo: UserDirectoryRepository = {
    getRegistrationRank: async () => rankValue,
  } as unknown as UserDirectoryRepository;

  const settingsService: SettingsService = {
    getLaunchPromo: async () => merged,
  } as unknown as SettingsService;

  const redemptionCodeService: RedemptionCodeService = {
    mint: async (p: { grants: unknown }) => {
      mintCalls.push({ grants: p.grants });
      if (opts.mintShouldFail) throw new Error("mint blew up");
      return {
        _id: "code-id-1",
        code: "LAUNCH-PROMO-TEST",
        grants: p.grants,
        createdAt: new Date(),
        createdBy: { userId: "x", email: "x", displayName: "x" },
        expiresAt: new Date(Date.now() + 86400_000),
        status: "active",
      } as never;
    },
  } as unknown as RedemptionCodeService;

  const notificationRepo: NotificationRepository = {
    create: async (input: { userId: string; title: string; data?: unknown }) => {
      notifications.push({ userId: input.userId, title: input.title });
      return { _id: "n1", ...input, data: input.data ?? {}, readAt: null, createdAt: new Date() } as never;
    },
  } as unknown as NotificationRepository;

  const service = new LaunchPromoService({
    repo,
    userDirectoryRepo,
    settingsService,
    redemptionCodeService,
    notificationRepo,
  });
  return { service, claims, notifications, mintCalls };
}

describe("LaunchPromoService.awardUser", () => {
  let now: Date;
  beforeEach(() => {
    now = new Date();
    void now;
  });

  it("happy path: mints code + records claim + drops notification", async () => {
    const fx = makeService({ rank: 7, awarded: 3 });
    const out = await fx.service.awardUser({ userId: "u-7", awardedBy: "admin-1" });

    expect(out.claim._id).toBe("u-7");
    expect(out.claim.eligibilityRank).toBe(7);
    expect(out.claim.redemptionCodeId).toBe("code-id-1");
    expect(out.claim.awardedBy).toBe("admin-1");
    expect(out.redemptionCode).toBe("LAUNCH-PROMO-TEST");
    expect(fx.claims).toHaveLength(1);
    expect(fx.notifications).toHaveLength(1);
    expect(fx.notifications[0]!.userId).toBe("u-7");
    expect(fx.notifications[0]!.title).toContain("LAUNCH-PROMO-TEST");
    expect(fx.mintCalls[0]!.grants).toEqual([
      { surface: "playground", amount: 200 },
      { surface: "skillGen", amount: 200 },
    ]);
  });

  it("PROMO_DISABLED when section.enabled is false", async () => {
    const fx = makeService({ section: { enabled: false } });
    await expect(fx.service.awardUser({ userId: "u", awardedBy: "a" })).rejects.toThrow(
      /^PROMO_DISABLED:/,
    );
    expect(fx.claims).toHaveLength(0);
    expect(fx.notifications).toHaveLength(0);
  });

  it("PROMO_DISABLED when both grant amounts are zero", async () => {
    const fx = makeService({ section: { awardPlayground: 0, awardSkillGen: 0 } });
    await expect(fx.service.awardUser({ userId: "u", awardedBy: "a" })).rejects.toThrow(
      /^PROMO_DISABLED:/,
    );
  });

  it("ALREADY_CLAIMED short-circuits before mint", async () => {
    const fx = makeService({ hasClaimed: true });
    await expect(fx.service.awardUser({ userId: "u", awardedBy: "a" })).rejects.toThrow(
      /^ALREADY_CLAIMED:/,
    );
    expect(fx.mintCalls).toHaveLength(0);
  });

  it("USER_NOT_FOUND when directory has no rank", async () => {
    const fx = makeService({ rank: null });
    await expect(fx.service.awardUser({ userId: "u", awardedBy: "a" })).rejects.toThrow(
      /^USER_NOT_FOUND:/,
    );
  });

  it("RANK_EXCEEDED when user rank is past totalSlots", async () => {
    const fx = makeService({ rank: 600 }); // > totalSlots 500
    await expect(fx.service.awardUser({ userId: "u", awardedBy: "a" })).rejects.toThrow(
      /^RANK_EXCEEDED:/,
    );
  });

  it("SLOTS_EXHAUSTED when awarded already met totalSlots", async () => {
    const fx = makeService({ rank: 1, awarded: 500 });
    await expect(fx.service.awardUser({ userId: "u", awardedBy: "a" })).rejects.toThrow(
      /^SLOTS_EXHAUSTED:/,
    );
  });

  it("duplicate-key race during insert maps to ALREADY_CLAIMED", async () => {
    const fx = makeService({ rank: 5, insertShouldFail: "duplicate" });
    await expect(fx.service.awardUser({ userId: "u", awardedBy: "a" })).rejects.toThrow(
      /^ALREADY_CLAIMED:/,
    );
  });

  it("notification failure does NOT throw — claim still recorded", async () => {
    const fx = makeService({ rank: 5 });
    // Sabotage notification repo with a throwing create.
    void fx; // fx used for claims assertion below
    const svc = new LaunchPromoService({
      repo: {
        ensureIndexes: async () => {},
        hasClaimed: async () => false,
        findByUserId: async () => null,
        insert: async (doc: LaunchPromoClaimDoc) => fx.claims.push(doc),
        countAwarded: async () => 0,
        listRecent: async () => fx.claims.slice(),
      } as unknown as LaunchPromoRepository,
      userDirectoryRepo: { getRegistrationRank: async () => 5 } as unknown as UserDirectoryRepository,
      settingsService: { getLaunchPromo: async () => DEFAULT_SECTION } as unknown as SettingsService,
      redemptionCodeService: {
        mint: async () => ({ _id: "c", code: "X", grants: [], createdAt: new Date(), createdBy: {} as never, expiresAt: new Date(), status: "active" } as never),
      } as unknown as RedemptionCodeService,
      notificationRepo: {
        create: async () => { throw new Error("notif down"); },
      } as unknown as NotificationRepository,
    });
    const out = await svc.awardUser({ userId: "u", awardedBy: "a" });
    expect(out.claim).toBeTruthy();
    expect(fx.claims).toHaveLength(1);
  });

  it("error sentinels list stays exhaustive", () => {
    expect(LAUNCH_PROMO_ERROR_PREFIXES).toEqual([
      "PROMO_DISABLED",
      "RANK_EXCEEDED",
      "SLOTS_EXHAUSTED",
      "ALREADY_CLAIMED",
      "USER_NOT_FOUND",
    ]);
  });
});

describe("LaunchPromoService.getStatusForUser", () => {
  it("composes promo enabled + claim + rank + slots remaining", async () => {
    const fx = makeService({ rank: 12, awarded: 100 });
    const status = await fx.service.getStatusForUser("u-12");
    expect(status).toEqual({
      promoEnabled: true,
      claimed: false,
      rank: 12,
      totalSlots: 500,
      slotsRemaining: 400,
      awardedAt: null,
    });
  });

  it("claimed=true with awardedAt set when user has claim doc", async () => {
    const fx = makeService({ rank: 4 });
    await fx.service.awardUser({ userId: "u-4", awardedBy: "admin" });
    const status = await fx.service.getStatusForUser("u-4");
    expect(status.claimed).toBe(true);
    expect(status.awardedAt).not.toBeNull();
  });
});
