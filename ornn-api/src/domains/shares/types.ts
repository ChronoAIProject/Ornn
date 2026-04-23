/**
 * Share-request types.
 *
 * A `ShareRequest` is the durable state that tracks one attempt to
 * share a skill with a target (another person, an org, or the public).
 * Audit results are captured on the request so the justification + review
 * queue can reason about them without re-fetching.
 *
 * State machine:
 *
 *    pending-audit
 *        │
 *        ▼
 *    ┌────────┬───────────────────┐
 *    │        │                   │
 *    ▼        ▼                   ▼
 *   green  needs-justification  failed-audit
 *            │
 *            ▼   (owner submits justifications)
 *        pending-review
 *            │
 *            ▼
 *    ┌───────┬─────────┬────────┐
 *    │       │         │        │
 *    ▼       ▼         ▼        ▼
 *  accepted rejected cancelled  (+ re-audit, etc.)
 *
 * @module domains/shares/types
 */

import type { AuditVerdict } from "../skills/audit/types";

export type ShareTargetType = "user" | "org" | "public";

/**
 * A share target. For `user` / `org` we record a NyxID user_id; for
 * `public` there is no target id.
 */
export interface ShareTarget {
  readonly type: ShareTargetType;
  /** NyxID user_id or org id. Omitted for `public`. */
  readonly id?: string;
}

export type ShareStatus =
  | "pending-audit"
  | "green"
  | "needs-justification"
  | "pending-review"
  | "accepted"
  | "rejected"
  | "cancelled";

export interface ShareJustifications {
  readonly whyCannotPass: string;
  readonly whySafe: string;
  readonly whyShare: string;
  readonly submittedAt: Date;
}

export interface ShareReviewerDecision {
  readonly decision: "accept" | "reject";
  readonly note?: string;
  readonly reviewerUserId: string;
  readonly reviewedAt: Date;
}

export interface ShareRequest {
  readonly _id: string;
  readonly skillGuid: string;
  readonly skillVersion: string;
  readonly skillHash: string;
  readonly ownerUserId: string;
  readonly target: ShareTarget;
  readonly status: ShareStatus;
  /** Audit verdict at the time of share. `undefined` while still in pending-audit. */
  readonly auditVerdict?: AuditVerdict;
  /** Overall audit score snapshot. */
  readonly auditOverallScore?: number;
  /** Pointer to the `skill_audits` row that was reused / created. */
  readonly auditRecordId?: string;
  readonly justifications?: ShareJustifications;
  readonly reviewerDecision?: ShareReviewerDecision;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
