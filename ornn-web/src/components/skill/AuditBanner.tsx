/**
 * Banner on `SkillDetailPage` showing the skill's audit verdict.
 *
 * - No audit yet → hidden for readers; compact "Run audit" CTA for
 *   anyone with `canTriggerAudit` (owners + platform admins).
 * - Audit exists → verdict pill, overall score, timestamp; expandable to
 *   show per-dimension scores and findings. Triggerers get a "Rerun"
 *   button; the mutation sync-updates the banner state via query-cache
 *   priming in `useRerunAudit`.
 *
 * @module components/skill/AuditBanner
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRerunAudit, useSkillAudit } from "@/hooks/useAudit";
import type {
  AuditFinding,
  AuditRecord,
  AuditScore,
  AuditVerdict,
} from "@/types/audit";

interface AuditBannerProps {
  /** Skill id or name. Empty/undefined suppresses the banner. */
  idOrName: string | undefined;
  /** Optional pin; omit for latest. */
  version?: string;
  /** Caller can rerun / trigger initial audits. */
  canTriggerAudit: boolean;
  className?: string;
}

const VERDICT_STYLE: Record<
  AuditVerdict,
  { ring: string; dot: string; label: string; text: string; bg: string }
> = {
  green: {
    ring: "border-neon-cyan/40",
    dot: "bg-neon-cyan",
    label: "Pass",
    text: "text-neon-cyan",
    bg: "bg-neon-cyan/5",
  },
  yellow: {
    ring: "border-neon-yellow/40",
    dot: "bg-neon-yellow",
    label: "Warnings",
    text: "text-neon-yellow",
    bg: "bg-neon-yellow/5",
  },
  red: {
    ring: "border-neon-red/40",
    dot: "bg-neon-red",
    label: "Fail",
    text: "text-neon-red",
    bg: "bg-neon-red/5",
  },
};

function DimensionLabel({ dim }: { dim: string }) {
  // Pretty-print the snake_case dimension names.
  const pretty = dim
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
  return <span className="font-heading text-xs uppercase tracking-wider text-text-muted">{pretty}</span>;
}

function ScoreCell({ score }: { score: AuditScore }) {
  const warn = score.score < 5;
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        warn ? "border-neon-yellow/30 bg-neon-yellow/5" : "border-neon-cyan/15 bg-bg-surface/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <DimensionLabel dim={score.dimension} />
        <span
          className={`font-mono text-sm font-bold ${
            warn ? "text-neon-yellow" : "text-text-primary"
          }`}
        >
          {score.score}/10
        </span>
      </div>
      <p className="mt-1 font-body text-xs text-text-muted leading-snug">{score.rationale}</p>
    </div>
  );
}

function FindingRow({ f }: { f: AuditFinding }) {
  const severityStyle =
    f.severity === "critical"
      ? "text-neon-red border-neon-red/30 bg-neon-red/5"
      : f.severity === "warning"
        ? "text-neon-yellow border-neon-yellow/30 bg-neon-yellow/5"
        : "text-text-muted border-neon-cyan/15 bg-bg-surface/30";
  return (
    <div className={`flex flex-col gap-1 rounded-lg border px-3 py-2 ${severityStyle}`}>
      <div className="flex items-center gap-2">
        <span className="font-heading text-[10px] uppercase tracking-wider">{f.severity}</span>
        <DimensionLabel dim={f.dimension} />
        {f.file && (
          <span className="font-mono text-xs text-text-muted">
            {f.file}
            {typeof f.line === "number" ? `:${f.line}` : ""}
          </span>
        )}
      </div>
      <p className="font-body text-sm text-text-primary/90">{f.message}</p>
    </div>
  );
}

function AuditBannerInner({
  record,
  idOrName,
  version,
  canTriggerAudit,
  className,
}: {
  record: AuditRecord;
  idOrName: string;
  version?: string;
  canTriggerAudit: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const rerun = useRerunAudit();

  const style = VERDICT_STYLE[record.verdict];
  const createdAt = new Date(record.createdAt);
  const timestampLabel = Number.isNaN(createdAt.getTime())
    ? record.createdAt
    : createdAt.toLocaleString();

  const handleRerun = () => {
    rerun.mutate({ idOrName, version, force: true });
  };

  return (
    <div
      role="status"
      aria-label="Skill audit verdict"
      className={`glass rounded-xl border ${style.ring} ${style.bg} ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 cursor-pointer"
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
        <span className={`font-heading text-sm uppercase tracking-wider ${style.text}`}>
          Audit · {style.label}
        </span>
        <span className="font-mono text-sm text-text-primary">
          {record.overallScore.toFixed(1)} / 10
        </span>
        <span className="font-body text-xs text-text-muted hidden sm:inline">
          · v{record.version} · {timestampLabel}
        </span>
        <div className="flex-1" />
        {canTriggerAudit && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              if (!rerun.isPending) handleRerun();
            }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !rerun.isPending) {
                e.stopPropagation();
                handleRerun();
              }
            }}
            className={`rounded-lg border border-neon-cyan/30 px-3 py-1 font-body text-xs text-text-primary transition-colors ${
              rerun.isPending ? "opacity-50" : "hover:bg-neon-cyan/10 cursor-pointer"
            }`}
          >
            {rerun.isPending ? t("audit.rerunning", "Rerunning…") : t("audit.rerun", "Rerun")}
          </span>
        )}
        <svg
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-neon-cyan/10 px-4 py-4 space-y-4">
          <section>
            <h4 className="mb-2 font-heading text-xs uppercase tracking-wider text-text-muted">
              {t("audit.scoresHeading", "Scores by dimension")}
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {record.scores.map((s) => (
                <ScoreCell key={s.dimension} score={s} />
              ))}
            </div>
          </section>

          <section>
            <h4 className="mb-2 font-heading text-xs uppercase tracking-wider text-text-muted">
              {t("audit.findingsHeading", "Findings")}
              <span className="ml-2 font-mono text-text-muted normal-case tracking-normal">
                ({record.findings.length})
              </span>
            </h4>
            {record.findings.length === 0 ? (
              <p className="font-body text-sm text-text-muted">
                {t("audit.noFindings", "No findings — the auditor had nothing to flag.")}
              </p>
            ) : (
              <div className="space-y-2">
                {record.findings.map((f, idx) => (
                  <FindingRow key={`${f.dimension}-${idx}`} f={f} />
                ))}
              </div>
            )}
          </section>

          <p className="font-body text-xs text-text-muted">
            {t("audit.model", "Model")}: <span className="font-mono">{record.model}</span>
            {" · "}
            {t("audit.triggeredBy", "Triggered by")}:{" "}
            <span className="font-mono">{record.triggeredBy}</span>
          </p>
        </div>
      )}
    </div>
  );
}

export function AuditBanner({ idOrName, version, canTriggerAudit, className }: AuditBannerProps) {
  const { t } = useTranslation();
  const { data: record, isLoading, isError } = useSkillAudit(idOrName, { version });
  const rerun = useRerunAudit();

  if (!idOrName || isLoading || isError) return null;

  if (!record) {
    // Not audited yet. Only admins get an affordance to kick off the first run.
    if (!canTriggerAudit) return null;
    return (
      <div
        className={`glass flex items-center gap-3 rounded-xl border border-neon-cyan/15 bg-bg-surface/40 px-4 py-3 ${
          className ?? ""
        }`}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-text-muted" />
        <span className="font-heading text-sm uppercase tracking-wider text-text-muted">
          {t("audit.notRunYet", "Audit · not run yet")}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => rerun.mutate({ idOrName, version, force: true })}
          disabled={rerun.isPending}
          className="rounded-lg border border-neon-cyan/30 px-3 py-1 font-body text-xs text-text-primary transition-colors hover:bg-neon-cyan/10 cursor-pointer disabled:opacity-50"
        >
          {rerun.isPending
            ? t("audit.running", "Running…")
            : t("audit.runFirst", "Run audit")}
        </button>
      </div>
    );
  }

  return (
    <AuditBannerInner
      record={record}
      idOrName={idOrName}
      version={version}
      canTriggerAudit={canTriggerAudit}
      className={className}
    />
  );
}
