/**
 * AgentSealTrustBadge — security trust badge for the skill detail page.
 *
 * #253 surface. Shows the score (0–100) + band label, plus an
 * expandable findings list. Industrial Forge palette per DESIGN.md —
 * forge-credible mineral greens / brass / kiln red, never raw consumer
 * greens / reds. Hard-offset letterpress impression matches every other
 * card on the page; press-down hover applies via the standard
 * `card-impression` token.
 *
 * Empty / unscanned state: a subtle "Not scanned" tile with the same
 * silhouette as the scored variant so the right-rail spacing stays
 * consistent across skills with and without scans.
 *
 * @module components/agentseal/AgentSealTrustBadge
 */

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  styleForScore,
  formatAgentSealVersion,
  type AgentSealBand,
} from "@/lib/agentsealBand";
import type { AgentSealScan, AgentSealFinding } from "@/types/domain";

export interface AgentSealTrustBadgeProps {
  scan: AgentSealScan | null | undefined;
  /** Optional; defaults to a sensible card class */
  className?: string;
}

/** Format the scan timestamp in SGT for consistency with the audit card. */
function formatDateSGT(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString("en-SG", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return dateStr;
  }
}

/** Severity precedence for sorting findings worst-first. */
const SEVERITY_RANK: Record<AgentSealFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function AgentSealTrustBadge({
  scan,
  className = "",
}: AgentSealTrustBadgeProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const findingsId = useId();

  // Unscanned variant — keep the silhouette so the right rail doesn't
  // jolt vertically when scrolling between scanned and unscanned skills.
  if (!scan) {
    return (
      <section
        className={`card-impression rounded-md border border-subtle bg-card p-5 ${className}`}
        aria-label={t("agentseal.cardLabel", "Trust score")}
      >
        <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
          <ShieldIcon className="h-[11px] w-[11px]" />
          {t("agentseal.cardTitle", "Trust score")}
        </h3>
        <div className="mb-3.5 flex items-center gap-3 rounded-sm border border-strong-edge bg-elevated/60 p-3 font-mono text-[11px] uppercase tracking-wider text-meta">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-strong-edge text-meta"
            aria-hidden
          >
            <CircleIcon className="h-3.5 w-3.5" />
          </div>
          <span>{t("agentseal.unscanned", "Not scanned")}</span>
        </div>
        <p className="font-mono text-[11px] leading-relaxed tracking-wide text-meta">
          {t(
            "agentseal.unscannedHint",
            "AgentSeal scans run on every new version publish. Older versions predate the scanner.",
          )}
        </p>
      </section>
    );
  }

  const score = clampScore(scan.score);
  const style = styleForScore(score);
  const sortedFindings = [...scan.findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  return (
    <section
      className={`card-impression rounded-md border border-subtle bg-card p-5 ${className}`}
      data-band={style.band}
      aria-label={t("agentseal.cardLabel", "Trust score")}
    >
      <h3 className="mb-3.5 flex items-center gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
        <ShieldIcon className="h-[11px] w-[11px]" />
        {t("agentseal.cardTitle", "Trust score")}
      </h3>

      {/* Score + band tile — identical silhouette to the audit-card
          verdict tile so the two right-rail signals read as siblings. */}
      <div
        className={`mb-3.5 flex items-center gap-3 rounded-sm border p-3 ${style.surface}`}
      >
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sm font-mono text-xs font-semibold ${style.swatch}`}
          aria-hidden
        >
          {score}
        </div>
        <div className="flex flex-col gap-0.5">
          <div>
            <span className="font-display text-2xl font-semibold leading-none">
              {score}
            </span>
            <span className="ml-1 font-mono text-[11px] tracking-wide text-meta">
              / 100
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
            {style.label}
          </span>
        </div>
      </div>

      <p className="font-mono text-[11px] leading-relaxed tracking-wide text-meta">
        {t("agentseal.scannedAt", "Scanned {{date}}", {
          date: formatDateSGT(scan.scannedAt),
        })}
        {scan.version && (
          <>
            {" · "}
            {formatAgentSealVersion(scan.version)}
          </>
        )}
      </p>

      {/* Findings disclosure. Always rendered (even at zero) so the
          control is discoverable; collapsed by default. */}
      <div className="mt-3.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={findingsId}
          className="inline-flex items-center gap-1 self-start py-1 font-mono text-[10px] uppercase tracking-widest text-accent transition-all hover:text-accent-muted hover:gap-2"
        >
          <span>
            {sortedFindings.length === 0
              ? t("agentseal.findingsClean", "No findings")
              : t("agentseal.findingsCount", "{{n}} findings", {
                  n: sortedFindings.length,
                })}
          </span>
          {sortedFindings.length > 0 && (
            <ChevronIcon
              className={`h-2.5 w-2.5 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          )}
        </button>

        {expanded && sortedFindings.length > 0 && (
          <ul
            id={findingsId}
            className="mt-2 flex flex-col gap-2 border-t border-dashed border-subtle pt-3"
          >
            {sortedFindings.map((f, idx) => (
              <FindingRow key={`${f.ruleId}-${idx}`} finding={f} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FindingRow({ finding }: { finding: AgentSealFinding }) {
  const tone = severityTone(finding.severity);
  return (
    <li
      className={`rounded-sm border px-2.5 py-2 ${tone.surface}`}
      data-severity={finding.severity}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${tone.ink}`}>
          {finding.severity}
        </span>
        <span className="truncate font-mono text-[10px] text-meta" title={finding.ruleId}>
          {finding.ruleId}
        </span>
      </div>
      <p className="mt-1 font-display text-[12px] font-semibold leading-tight text-strong">
        {finding.title}
      </p>
      <p className="mt-1 font-text text-[11px] leading-relaxed text-body">
        {finding.message}
      </p>
      {finding.location && (
        <p className="mt-1 font-mono text-[10px] text-meta">
          {finding.location.file}
          {finding.location.line != null && `:${finding.location.line}`}
        </p>
      )}
    </li>
  );
}

interface SeverityTone {
  surface: string;
  ink: string;
}

function severityTone(severity: AgentSealFinding["severity"]): SeverityTone {
  switch (severity) {
    case "critical":
      return {
        surface: "border-danger/40 bg-danger-soft",
        ink: "text-danger",
      };
    case "high":
      return {
        surface: "border-danger/30 bg-danger-soft/70",
        ink: "text-danger",
      };
    case "medium":
      return {
        surface: "border-warning/40 bg-warning-soft",
        ink: "text-warning",
      };
    case "low":
      return {
        surface: "border-warning/30 bg-warning-soft/70",
        ink: "text-warning",
      };
    case "info":
    default:
      return {
        surface: "border-subtle bg-elevated/40",
        ink: "text-meta",
      };
  }
}

function clampScore(raw: number): number {
  if (Number.isNaN(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// — Icons (inline so the badge has no external icon dep) ————————

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function CircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

export type { AgentSealBand };
