/**
 * Share-request TS types mirroring the backend state machine.
 *
 * State progression:
 *
 *    pending-audit → { green · needs-justification · failed-audit }
 *                    ↓
 *              pending-review → { accepted · rejected · cancelled }
 *
 * @module types/shares
 */

import type { AuditVerdict } from "./audit";

export type ShareTargetType = "user" | "org" | "public";

export interface ShareTarget {
  type: ShareTargetType;
  /** NyxID user_id / org user_id. Omitted for `public`. */
  id?: string;
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
  whyCannotPass: string;
  whySafe: string;
  whyShare: string;
  submittedAt: string;
}

export interface ShareReviewerDecision {
  decision: "accept" | "reject";
  note?: string;
  reviewerUserId: string;
  reviewedAt: string;
}

export interface ShareRequest {
  _id: string;
  skillGuid: string;
  skillVersion: string;
  skillHash: string;
  ownerUserId: string;
  target: ShareTarget;
  status: ShareStatus;
  auditVerdict?: AuditVerdict;
  auditOverallScore?: number;
  auditRecordId?: string;
  justifications?: ShareJustifications;
  reviewerDecision?: ShareReviewerDecision;
  createdAt: string;
  updatedAt: string;
}

/** The backend accepts this shape on `POST /skills/:idOrName/share`. */
export interface InitiateShareInput {
  targetType: ShareTargetType;
  /** Required for `user` / `org`; omit for `public`. */
  targetId?: string;
}

export interface SubmitJustificationInput {
  whyCannotPass: string;
  whySafe: string;
  whyShare: string;
}

export interface ReviewDecisionInput {
  decision: "accept" | "reject";
  note?: string;
}

/** Statuses that the owner can still cancel out of. */
export const CANCELLABLE_STATUSES: ReadonlySet<ShareStatus> = new Set([
  "pending-audit",
  "needs-justification",
  "pending-review",
]);

/** Statuses that are a final outcome, for UI styling. */
export const TERMINAL_STATUSES: ReadonlySet<ShareStatus> = new Set([
  "accepted",
  "rejected",
  "cancelled",
]);
