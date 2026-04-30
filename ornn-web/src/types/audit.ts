/**
 * Skill audit types. Shape mirrors the backend's `AuditRecord` with
 * `Date` fields serialized as ISO strings.
 *
 * @module types/audit
 */

export type AuditDimension =
  | "security"
  | "code_quality"
  | "documentation"
  | "reliability"
  | "permission_scope";

export const AUDIT_DIMENSIONS: readonly AuditDimension[] = [
  "security",
  "code_quality",
  "documentation",
  "reliability",
  "permission_scope",
] as const;

export type AuditVerdict = "green" | "yellow" | "red";

export type AuditStatus = "running" | "completed" | "failed";

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditScore {
  dimension: AuditDimension;
  /** 0–10 integer. */
  score: number;
  /** Short human-readable rationale (1–2 sentences). */
  rationale: string;
}

export interface AuditFinding {
  dimension: AuditDimension;
  severity: AuditSeverity;
  file?: string;
  line?: number;
  message: string;
}

export interface AuditRecord {
  _id: string;
  skillGuid: string;
  version: string;
  skillHash: string;
  /** Lifecycle state. Running rows have placeholder verdict/score. */
  status: AuditStatus;
  verdict: AuditVerdict;
  /** 0–10 weighted average. */
  overallScore: number;
  scores: AuditScore[];
  findings: AuditFinding[];
  model: string;
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
  triggeredBy: string;
}
