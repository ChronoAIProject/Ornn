/**
 * Types for the skill-audit system.
 *
 * An `AuditRecord` is the LLM-scored review of one specific skill
 * version. Records are cached by (skillGuid, version, skillHash) — if
 * the same package bytes are shared again within the TTL, we reuse
 * rather than re-audit.
 *
 * @module domains/skills/audit/types
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

export interface AuditScore {
  readonly dimension: AuditDimension;
  /** 0–10 integer score from the LLM. */
  readonly score: number;
  /** Short human-readable rationale for the score (1–2 sentences). */
  readonly rationale: string;
}

export interface AuditFinding {
  readonly dimension: AuditDimension;
  readonly severity: "info" | "warning" | "critical";
  /** Optional — file path inside the skill package. */
  readonly file?: string;
  /** Optional — line number in `file`. */
  readonly line?: number;
  /** Short description. */
  readonly message: string;
}

/** Overall verdict. Green = safe to share silently. */
export type AuditVerdict = "green" | "yellow" | "red";

/**
 * Audit lifecycle status.
 *
 *   running    — row created when the user triggered the audit; the LLM
 *                pipeline is still in flight, so `verdict/overallScore/
 *                scores/findings` aren't final yet (zeroes / empty).
 *   completed  — pipeline finished, every result field is populated.
 *   failed     — pipeline errored out (storage fetch, LLM call, etc.);
 *                `errorMessage` holds a short cause.
 */
export type AuditStatus = "running" | "completed" | "failed";

export interface AuditRecord {
  readonly _id: string;
  readonly skillGuid: string;
  readonly version: string;
  /** SHA-256 of the skill package bytes at audit time. */
  readonly skillHash: string;
  readonly status: AuditStatus;
  readonly verdict: AuditVerdict;
  /** 0–10 weighted average. Convenience — derivable from `scores`. */
  readonly overallScore: number;
  readonly scores: ReadonlyArray<AuditScore>;
  readonly findings: ReadonlyArray<AuditFinding>;
  /** The LLM model used, for audit traceability. */
  readonly model: string;
  readonly createdAt: Date;
  /** When the record moved from `running` to a terminal state. */
  readonly completedAt?: Date;
  /** Populated when status === "failed". */
  readonly errorMessage?: string;
  /**
   * User who triggered the audit. `system` when the audit-on-share
   * pipeline kicked it off automatically (to be wired in a later PR).
   */
  readonly triggeredBy: string;
}

export interface AuditThresholds {
  /** Minimum overall score to count as green. */
  readonly greenOverall: number;
  /** Any dimension below this pulls the verdict down regardless of overall. */
  readonly minPerDimension: number;
}

export const DEFAULT_AUDIT_THRESHOLDS: AuditThresholds = {
  greenOverall: 7.5,
  minPerDimension: 5,
};

/**
 * Weighted average over the 5 dimensions. All weights equal for now;
 * future-proofed as a lookup so we can tune without touching call
 * sites.
 */
const DIMENSION_WEIGHTS: Record<AuditDimension, number> = {
  security: 1,
  code_quality: 1,
  documentation: 1,
  reliability: 1,
  permission_scope: 1,
};

export function computeOverallScore(scores: ReadonlyArray<AuditScore>): number {
  if (scores.length === 0) return 0;
  let totalWeight = 0;
  let weighted = 0;
  for (const s of scores) {
    const w = DIMENSION_WEIGHTS[s.dimension] ?? 1;
    totalWeight += w;
    weighted += s.score * w;
  }
  const avg = weighted / totalWeight;
  // Round to 1 decimal.
  return Math.round(avg * 10) / 10;
}

/**
 * Classify a set of dimension scores into a verdict.
 *
 * `red` — any critical-severity finding, OR any dimension below
 * `minPerDimension - 2` (i.e. deeply unsafe in at least one area).
 * `yellow` — any dimension below `minPerDimension`, OR overall below
 * `greenOverall`.
 * `green` — overall ≥ `greenOverall` AND every dimension ≥
 * `minPerDimension` AND no critical findings.
 */
export function computeVerdict(
  scores: ReadonlyArray<AuditScore>,
  findings: ReadonlyArray<AuditFinding>,
  thresholds: AuditThresholds = DEFAULT_AUDIT_THRESHOLDS,
): AuditVerdict {
  const overall = computeOverallScore(scores);
  const hasCritical = findings.some((f) => f.severity === "critical");
  const lowestDimScore = scores.length > 0 ? Math.min(...scores.map((s) => s.score)) : 0;

  if (hasCritical) return "red";
  if (lowestDimScore < thresholds.minPerDimension - 2) return "red";
  if (lowestDimScore < thresholds.minPerDimension) return "yellow";
  if (overall < thresholds.greenOverall) return "yellow";
  return "green";
}
