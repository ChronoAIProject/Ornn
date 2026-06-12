/**
 * Launch-promo domain types (#724).
 *
 * One claim doc per Ornn user that's been awarded the launch-promo
 * grant. Append-only: a user is either present (already awarded, code
 * delivered) or absent. The doc id is the Ornn user id so the
 * idempotency gate is a single `findOne` on a primary-key lookup; no
 * scan needed.
 *
 * @module domains/launchPromo/types
 */

export interface LaunchPromoClaimDoc {
  /** Ornn user id (NyxID user.userId). Primary key. */
  _id: string;
  /** Cached Ornn registration rank when the claim was awarded
   *  (1-based; 1 == the very first Ornn user). Stored so an admin
   *  audit can answer "why was this user eligible" without re-running
   *  the rank query. */
  eligibilityRank: number;
  /** Redemption-codes domain id of the minted code (admin can pull
   *  the actual code string via that id). */
  redemptionCodeId: string;
  /** UTC timestamp of the award. */
  awardedAt: Date;
  /** Who triggered the award — admin user id for manual flows,
   *  `"system:cron"` for the GH stargazers cron loop. */
  awardedBy: string;
  /** GitHub login at award time, when known. Optional — the cron
   *  path populates it (it knows: that's how it matched the user);
   *  the admin manual-award path may not. */
  githubLogin?: string;
}

/** Caller-facing status for `GET /me/launch-promo`. */
export interface LaunchPromoStatus {
  /** Whether the promo section is enabled in admin settings. */
  promoEnabled: boolean;
  /** Whether the caller has already claimed (and code was delivered). */
  claimed: boolean;
  /** Caller's 1-based Ornn registration rank, or null if unknown. */
  rank: number | null;
  /** Total slots configured (e.g. 500). */
  totalSlots: number;
  /** Slots remaining (totalSlots - awarded count). */
  slotsRemaining: number;
  /** ISO timestamp of the claim, if claimed. */
  awardedAt: string | null;
}
