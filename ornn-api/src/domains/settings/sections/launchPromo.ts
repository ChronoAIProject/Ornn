/**
 * Launch-promo section schema (#724).
 *
 * Drives the GitHub-star → Ornn-credit promo announced on the landing /
 * news page. The cron job (and admin manual-award endpoint) read this
 * section to decide whether the promo is active, where to look for
 * stargazers, how many slots are still available, and what the per-claim
 * grants are.
 *
 * Defaults are deliberately conservative: `enabled: false` and zero
 * grants. An admin has to opt in + configure the slot count + grant
 * amounts explicitly before any claim can land.
 *
 * @module domains/settings/sections/launchPromo
 */

import { z } from "zod";
import type { SectionMeta } from "./index";

/** GitHub `owner/repo` slug regex. */
const REPO_SEGMENT_RE = /^[A-Za-z0-9._-]{1,100}$/;

export const launchPromoSchema = z.object({
  enabled: z.boolean(),
  /** GitHub repo owner (login). */
  repoOwner: z.string().regex(REPO_SEGMENT_RE).or(z.literal("")),
  /** GitHub repo name. */
  repoName: z.string().regex(REPO_SEGMENT_RE).or(z.literal("")),
  /**
   * Maximum number of Ornn users that can ever claim this promo. The
   * service refuses to award if `claimed >= totalSlots`. Per the design
   * decision: "first 500 by Ornn registration order".
   */
  totalSlots: z.number().int().min(0).max(100000),
  /** Per-claim grant — Playground surface (monthly credits). */
  awardPlayground: z.number().int().min(0).max(1_000_000),
  /** Per-claim grant — Skill Generation surface. */
  awardSkillGen: z.number().int().min(0).max(1_000_000),
  /**
   * Cron poll interval. Set to 0 to disable the auto-poll loop entirely
   * (admin still gets the manual award endpoints). 5–10 min is the
   * sweet spot per the #724 design call.
   */
  pollIntervalMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  /**
   * Days a minted launch-promo redemption code stays valid before
   * expiry. The promo announcement promises "delivered within 24h"; the
   * code itself sticks around longer so users can redeem at their
   * leisure.
   */
  codeExpiryDays: z.number().int().min(1).max(365),
  /**
   * Static NyxID invite code shown alongside the Ornn redemption code
   * in the per-claim notification body. Mirrors the code printed on
   * landing/news. Editable here so a rotation doesn't require a
   * redeploy.
   */
  nyxidInviteCode: z.string().max(64).or(z.literal("")),
});

export type LaunchPromoSection = z.infer<typeof launchPromoSchema>;

export const launchPromoDefaults: LaunchPromoSection = {
  enabled: false,
  repoOwner: "",
  repoName: "",
  totalSlots: 500,
  awardPlayground: 200,
  awardSkillGen: 200,
  pollIntervalMs: 10 * 60 * 1000,
  codeExpiryDays: 90,
  nyxidInviteCode: "",
};

export const launchPromoSection: SectionMeta<LaunchPromoSection> = {
  id: "launchPromo",
  publicPath: "launch-promo",
  schema: launchPromoSchema,
  secretFields: [],
  defaults: launchPromoDefaults,
};
