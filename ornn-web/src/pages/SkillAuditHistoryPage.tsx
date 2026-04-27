/**
 * Dedicated audit history page: `/skills/:idOrName/audits`. Shows every
 * audit record stored for the skill (one row per audited version, newest
 * first) with expandable per-dimension scores + findings.
 *
 * @module pages/SkillAuditHistoryPage
 */

import { useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useSkill } from "@/hooks/useSkills";
import { useStartAudit, useSkillAuditHistory } from "@/hooks/useAudit";
import { isAdmin, useAuthStore } from "@/stores/authStore";
import type {
  AuditFinding,
  AuditRecord,
  AuditScore,
  AuditVerdict,
} from "@/types/audit";

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

function prettyDim(dim: string): string {
  return dim
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
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
        <span className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
          {prettyDim(score.dimension)}
        </span>
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
        <span className="font-heading text-[10px] uppercase tracking-wider text-text-muted">
          {prettyDim(f.dimension)}
        </span>
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

function RunningRow({ record }: { record: AuditRecord }) {
  const { t } = useTranslation();
  const createdAt = new Date(record.createdAt);
  const timestampLabel = Number.isNaN(createdAt.getTime())
    ? record.createdAt
    : createdAt.toLocaleString();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neon-cyan/20 bg-bg-surface/40 px-4 py-3">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan"
      />
      <span className="font-heading text-xs uppercase tracking-wider text-neon-cyan">
        {t("audit.statusRunning", "Running")}
      </span>
      <span className="font-mono text-xs text-text-muted">v{record.version}</span>
      <span className="font-body text-xs text-text-muted hidden sm:inline">
        {timestampLabel}
      </span>
      <div className="flex-1" />
      <span className="font-body text-xs text-text-muted">
        {t("audit.runningHint", "Scoring against the audit engine…")}
      </span>
    </div>
  );
}

function FailedRow({ record }: { record: AuditRecord }) {
  const { t } = useTranslation();
  const createdAt = new Date(record.createdAt);
  const timestampLabel = Number.isNaN(createdAt.getTime())
    ? record.createdAt
    : createdAt.toLocaleString();
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-neon-red/30 bg-neon-red/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-neon-red" />
        <span className="font-heading text-xs uppercase tracking-wider text-neon-red">
          {t("audit.statusFailed", "Failed")}
        </span>
        <span className="font-mono text-xs text-text-muted">v{record.version}</span>
        <span className="font-body text-xs text-text-muted hidden sm:inline">
          {timestampLabel}
        </span>
      </div>
      {record.errorMessage && (
        <p className="font-body text-xs text-text-muted break-words">
          {record.errorMessage}
        </p>
      )}
    </div>
  );
}

function HistoryRow({ record, defaultOpen }: { record: AuditRecord; defaultOpen: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultOpen);
  if (record.status === "running") return <RunningRow record={record} />;
  if (record.status === "failed") return <FailedRow record={record} />;
  const style = VERDICT_STYLE[record.verdict];
  const createdAt = new Date(record.createdAt);
  const timestampLabel = Number.isNaN(createdAt.getTime())
    ? record.createdAt
    : createdAt.toLocaleString();

  return (
    <div className={`rounded-lg border ${style.ring} ${style.bg}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 cursor-pointer"
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
        <span className={`font-heading text-xs uppercase tracking-wider ${style.text}`}>
          {style.label}
        </span>
        <span className="font-mono text-sm text-text-primary">
          {record.overallScore.toFixed(1)} / 10
        </span>
        <span className="font-mono text-xs text-text-muted">v{record.version}</span>
        <span className="font-body text-xs text-text-muted hidden sm:inline">
          {timestampLabel}
        </span>
        <div className="flex-1" />
        <span className="font-body text-xs text-text-muted hidden sm:inline">
          {record.findings.length}{" "}
          {record.findings.length === 1
            ? t("audit.findingOne", "finding")
            : t("audit.findingMany", "findings")}
        </span>
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
            <h4 className="mb-2 font-heading text-[11px] uppercase tracking-wider text-text-muted">
              {t("audit.scoresHeading", "Scores by dimension")}
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {record.scores.map((s) => (
                <ScoreCell key={s.dimension} score={s} />
              ))}
            </div>
          </section>

          <section>
            <h4 className="mb-2 font-heading text-[11px] uppercase tracking-wider text-text-muted">
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

export function SkillAuditHistoryPage() {
  const { t } = useTranslation();
  const { idOrName } = useParams<{ idOrName: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdminUser = isAdmin(user);

  const [searchParams] = useSearchParams();
  const versionFilter = searchParams.get("version") ?? undefined;

  const { data: skill } = useSkill(idOrName ?? "");
  const { data: items, isLoading, isError } = useSkillAuditHistory(idOrName, {
    version: versionFilter,
  });
  const startAuditMutation = useStartAudit();

  if (!idOrName) return null;

  const displayName = skill?.name || idOrName;

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <nav className="mb-4 font-body text-xs text-text-muted">
          <Link
            to={`/skills/${encodeURIComponent(idOrName)}`}
            className="hover:text-neon-cyan transition-colors"
          >
            ← {t("audit.backToSkill", "Back to skill")}
          </Link>
        </nav>

        <header className="mb-6 flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-2xl text-text-primary truncate">
              {displayName}
            </h1>
            <p className="mt-1 font-heading text-xs uppercase tracking-wider text-text-muted">
              {versionFilter
                ? t("audit.historyHeadingForVersion", "Audit history · v{{v}}", {
                    v: versionFilter,
                  })
                : t("audit.historyHeading", "Audit history")}
            </p>
          </div>
          {isAdminUser && (
            <Button
              onClick={() => startAuditMutation.mutate({ idOrName, force: true })}
              loading={startAuditMutation.isPending}
            >
              {items && items.length > 0
                ? t("audit.rerun", "Rerun")
                : t("audit.runFirst", "Run audit")}
            </Button>
          )}
        </header>

        <Card className="p-4">
          {isLoading ? (
            <p className="py-12 text-center font-body text-sm text-text-muted">
              {t("audit.historyLoading", "Loading audit history…")}
            </p>
          ) : isError ? (
            <div className="py-12 text-center">
              <p className="font-body text-sm text-neon-red">
                {t("audit.historyError", "Could not load audit history.")}
              </p>
              <Button
                variant="secondary"
                onClick={() => navigate(`/skills/${encodeURIComponent(idOrName)}`)}
                className="mt-4"
              >
                {t("audit.backToSkill", "Back to skill")}
              </Button>
            </div>
          ) : !items || items.length === 0 ? (
            <p className="py-12 text-center font-body text-sm text-text-muted">
              {isAdminUser
                ? t(
                    "audit.historyEmptyCanTrigger",
                    "No audits recorded yet. Click Run audit to score the current version.",
                  )
                : t("audit.historyEmpty", "No audits recorded yet.")}
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((rec, idx) => (
                <HistoryRow key={rec._id} record={rec} defaultOpen={idx === 0} />
              ))}
            </div>
          )}
        </Card>
        </div>
      </div>
    </PageTransition>
  );
}
