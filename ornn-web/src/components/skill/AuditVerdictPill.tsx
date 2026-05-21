/**
 * Audit-verdict tile shown inside the right-rail Audit card on SkillDetailPage (#453).
 *
 * Three visual states:
 *   - running (in-flight audit takes precedence even when a previous
 *     completed verdict exists for this version — the spinner wins)
 *   - never audited (the unknown / empty state — render a neutral pill)
 *   - completed (green / yellow / red tone driven by `audit.verdict`,
 *     with the numeric score + label)
 *
 * Stateless. Owner is `SkillDetailPage` (and any future page that wants
 * the same widget without re-implementing it).
 *
 * @module components/skill/AuditVerdictPill
 */

import { useTranslation } from "react-i18next";
import type { AuditRecord } from "@/types/audit";

export interface AuditVerdictPillProps {
  // exactOptionalPropertyTypes (#657)
  audit?: AuditRecord | undefined;
  running?: boolean | undefined;
}

export function AuditVerdictPill({ audit, running }: AuditVerdictPillProps) {
  const { t } = useTranslation();

  // In-flight audit takes precedence over the cached completed result —
  // even if there's a previous completed verdict on this version, surface
  // the spinner while a new run is scoring.
  if (running) {
    return (
      <div className="mb-3.5 flex items-center gap-3 rounded-sm border border-accent/30 bg-accent/5 p-3 font-mono text-[11px] uppercase tracking-wider text-accent">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-sm border border-accent/30"
          aria-hidden
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
        </div>
        <span>{t("skillDetail.auditRunning", "Audit in progress")}</span>
      </div>
    );
  }

  if (!audit || audit.status !== "completed") {
    return (
      <div className="mb-3.5 flex items-center gap-3 rounded-sm border border-strong-edge bg-elevated/60 p-3 font-mono text-[11px] uppercase tracking-wider text-meta">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-sm border border-strong-edge text-meta"
          aria-hidden
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>
        <span>{t("skillDetail.auditNone", "Not audited")}</span>
      </div>
    );
  }

  const tone =
    audit.verdict === "green"
      ? "border-success/30 bg-success-soft text-success"
      : audit.verdict === "yellow"
        ? "border-warning/30 bg-warning-soft text-warning"
        : "border-danger/30 bg-danger-soft text-danger";
  const label =
    audit.verdict === "green"
      ? t("skillDetail.auditPassLabel", "Pass · low risk")
      : audit.verdict === "yellow"
        ? t("skillDetail.auditWarnLabel", "Caution")
        : t("skillDetail.auditFailLabel", "Risk");

  return (
    <div className={`mb-3.5 flex items-center gap-3 rounded-sm border p-3 ${tone}`}>
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-current text-page"
        aria-hidden
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div className="flex flex-col gap-0.5">
        <div>
          <span className="font-display text-2xl font-semibold leading-none">
            {audit.overallScore.toFixed(1)}
          </span>
          <span className="ml-1 font-mono text-[11px] tracking-wide text-meta">/ 10</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">{label}</span>
      </div>
    </div>
  );
}
