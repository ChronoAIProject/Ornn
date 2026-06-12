/**
 * Launch-promo service (#724) — eligibility + award orchestration.
 *
 * Public surface:
 *
 *   - `getStatusForUser(userId)` — compose the `/me/launch-promo`
 *     response (promo on/off, claimed?, rank, slots remaining).
 *   - `awardUser({ userId, awardedBy, githubLogin? })` — the single
 *     award flow: gate on enabled + rank ≤ totalSlots + slot
 *     availability + not-already-claimed, mint a redemption code via
 *     the redemption-codes domain, drop a `launchPromo.codeDelivered`
 *     notification carrying the code, and record the claim.
 *
 * Idempotent: a second `awardUser` for the same user short-circuits
 * on the claim-row primary-key check. Race-safe: the claim insert
 * uses `_id = userId` so a duplicate-key error cleanly resolves the
 * "two callers tried to award the same user at the same instant"
 * case (one wins, the other gets `ALREADY_CLAIMED`).
 *
 * Out of scope here (follow-up PR): GitHub stargazers polling, the
 * cron loop, and the NyxID → GitHub login lookup. This service exposes
 * `awardUser` cleanly so the cron just calls it once it knows who
 * starred.
 *
 * @module domains/launchPromo/service
 */

import type { LaunchPromoRepository } from "./repository";
import type { LaunchPromoClaimDoc, LaunchPromoStatus } from "./types";
import type { UserDirectoryRepository } from "../users/repository";
import type { SettingsService } from "../settings/types";
import type { RedemptionCodeService } from "../redemption-codes/service";
import type { NotificationRepository } from "../notifications/repository";
import { createLogger } from "../../shared/logger";

const logger = createLogger("launchPromoService");

/** Sentinel `awardedBy` value the cron job uses; differentiates from
 *  human admin user-ids in the claim audit trail. */
export const CRON_ACTOR = "system:cron";

export const LAUNCH_PROMO_ERROR_PREFIXES = [
  "PROMO_DISABLED",
  "RANK_EXCEEDED",
  "SLOTS_EXHAUSTED",
  "ALREADY_CLAIMED",
  "USER_NOT_FOUND",
] as const;

export interface AwardUserParams {
  userId: string;
  awardedBy: string;
  /** Known when the cron matched the user via stargazer list. Stored
   *  on the claim doc for the audit trail. */
  githubLogin?: string;
}

export interface AwardUserResult {
  claim: LaunchPromoClaimDoc;
  /** The minted redemption code string — caller decides whether to
   *  surface in the notification body. */
  redemptionCode: string;
}

export interface LaunchPromoServiceDeps {
  repo: LaunchPromoRepository;
  userDirectoryRepo: UserDirectoryRepository;
  settingsService: SettingsService;
  redemptionCodeService: RedemptionCodeService;
  notificationRepo: NotificationRepository;
}

export class LaunchPromoService {
  private readonly repo: LaunchPromoRepository;
  private readonly userDirectoryRepo: UserDirectoryRepository;
  private readonly settingsService: SettingsService;
  private readonly redemptionCodeService: RedemptionCodeService;
  private readonly notificationRepo: NotificationRepository;

  constructor(deps: LaunchPromoServiceDeps) {
    this.repo = deps.repo;
    this.userDirectoryRepo = deps.userDirectoryRepo;
    this.settingsService = deps.settingsService;
    this.redemptionCodeService = deps.redemptionCodeService;
    this.notificationRepo = deps.notificationRepo;
  }

  /** Pass-through for the admin observability endpoint. */
  async repoListRecent(limit: number): Promise<LaunchPromoClaimDoc[]> {
    return this.repo.listRecent(limit);
  }

  async getStatusForUser(userId: string): Promise<LaunchPromoStatus> {
    const [section, rank, awarded, claim] = await Promise.all([
      this.settingsService.getLaunchPromo(),
      this.userDirectoryRepo.getRegistrationRank(userId),
      this.repo.countAwarded(),
      this.repo.findByUserId(userId),
    ]);

    return {
      promoEnabled: section.enabled,
      claimed: !!claim,
      rank,
      totalSlots: section.totalSlots,
      slotsRemaining: Math.max(0, section.totalSlots - awarded),
      awardedAt: claim ? claim.awardedAt.toISOString() : null,
    };
  }

  async awardUser(params: AwardUserParams): Promise<AwardUserResult> {
    const section = await this.settingsService.getLaunchPromo();
    if (!section.enabled) {
      throw new Error("PROMO_DISABLED: launch promo is not enabled");
    }

    // Idempotency: short-circuit on existing claim row before any
    // expensive lookup / mint.
    if (await this.repo.hasClaimed(params.userId)) {
      throw new Error(`ALREADY_CLAIMED: user '${params.userId}' has already claimed the launch promo`);
    }

    const rank = await this.userDirectoryRepo.getRegistrationRank(params.userId);
    if (rank === null) {
      throw new Error(`USER_NOT_FOUND: user '${params.userId}' is not in the directory`);
    }
    if (rank > section.totalSlots) {
      throw new Error(
        `RANK_EXCEEDED: user rank ${rank} is past the ${section.totalSlots}-slot cap`,
      );
    }

    const awarded = await this.repo.countAwarded();
    if (awarded >= section.totalSlots) {
      throw new Error(
        `SLOTS_EXHAUSTED: ${awarded}/${section.totalSlots} slots already awarded`,
      );
    }

    // Mint a redemption code that the user redeems themselves through
    // the existing /me/redeem UI. The promised "delivered within 24h"
    // is satisfied by the notification we drop below.
    const grants: Array<{ surface: "playground" | "skillGen"; amount: number }> = [];
    if (section.awardPlayground > 0) {
      grants.push({ surface: "playground", amount: section.awardPlayground });
    }
    if (section.awardSkillGen > 0) {
      grants.push({ surface: "skillGen", amount: section.awardSkillGen });
    }
    if (grants.length === 0) {
      // Misconfiguration: enabled with both grants = 0. Don't mint a
      // useless code.
      throw new Error("PROMO_DISABLED: launch promo has zero grants configured");
    }

    const expiresAt = new Date(
      Date.now() + section.codeExpiryDays * 24 * 60 * 60 * 1000,
    );
    const codeDoc = await this.redemptionCodeService.mint({
      admin: { userId: "system:launchPromo", email: "launch-promo@ornn", displayName: "Launch Promo" },
      grants,
      note: `launch-promo award for ${params.userId} (rank ${rank})`,
      expiresAt,
    });

    // Record the claim BEFORE the notification so a notification
    // failure can't leave us in "code minted but no claim row" state
    // that would let a retry double-mint.
    const claim: LaunchPromoClaimDoc = {
      _id: params.userId,
      eligibilityRank: rank,
      redemptionCodeId: codeDoc._id,
      awardedAt: new Date(),
      awardedBy: params.awardedBy,
      ...(params.githubLogin ? { githubLogin: params.githubLogin } : {}),
    };
    try {
      await this.repo.insert(claim);
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 11000) {
        // Race: someone else awarded in between our two queries.
        throw new Error(`ALREADY_CLAIMED: user '${params.userId}' claim landed in a race`, { cause: err });
      }
      throw err;
    }

    // Best-effort notification — claim is already recorded, so a
    // notification failure doesn't cost the user the grant. Admins can
    // resend via the notifications UI later.
    try {
      await this.notificationRepo.create({
        userId: params.userId,
        category: "launchPromo.codeDelivered",
        title: `Your launch promo is ready: ${codeDoc.code}`,
        body: [
          `You're in the first ${section.totalSlots} Ornn users — thank you for the early support!`,
          ``,
          `Redeem the code below in Settings → Redeem to add ${section.awardPlayground} Playground + ${section.awardSkillGen} Skill Generation credits to your account:`,
          ``,
          `    ${codeDoc.code}`,
          ``,
          section.nyxidInviteCode
            ? `The promo also bundles a NyxID invite code: ${section.nyxidInviteCode}`
            : "",
        ]
          .filter((line) => line !== "")
          .join("\n"),
        link: "/settings#redeem",
        data: {
          redemptionCodeId: codeDoc._id,
          redemptionCode: codeDoc.code,
          nyxidInviteCode: section.nyxidInviteCode || null,
          awardPlayground: section.awardPlayground,
          awardSkillGen: section.awardSkillGen,
        },
      });
    } catch (err) {
      logger.warn(
        { userId: params.userId, err: (err as Error).message },
        "Launch-promo notification delivery failed — claim is recorded",
      );
    }

    return { claim, redemptionCode: codeDoc.code };
  }
}
