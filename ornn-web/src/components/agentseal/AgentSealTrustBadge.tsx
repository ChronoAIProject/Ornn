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
import { apiPost } from "@/services/apiClient";
import { useToastStore } from "@/stores/toastStore";

export interface AgentSealTrustBadgeProps {
  scan: AgentSealScan | null | undefined;
  /** Optional; defaults to a sensible card class */
  className?: string;
  /**
   * Skill identifier — name or guid — required if `canRescan` is true.
   * The rescan endpoint is keyed by `:idOrName/:version` per
   * `POST /api/v1/admin/skills/:idOrName/versions/:version/agentseal-rescan`.
   */
  skillIdOrName?: string;
  /** Version to rescan — required if `canRescan` is true. */
  version?: string;
  /** True when the caller has the admin permission. Drives the Rescan affordance. */
  canRescan?: boolean;
  /** Fired after a successful rescan so the parent can invalidate caches. */
  onRescanned?: () => void;
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
  skillIdOrName,
  version,
  canRescan = false,
  onRescanned,
}: AgentSealTrustBadgeProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const findingsId = useId();
  const addToast = useToastStore((s) => s.addToast);

  const canShowRescan = canRescan && Boolean(skillIdOrName) && Boolean(version);

  async function handleRescan() {
    if (!skillIdOrName || !version || rescanning) return;
    setRescanning(true);
    try {
      const res = await apiPost<{ scan?: AgentSealScan | null }>(
        `/api/v1/admin/skills/${encodeURIComponent(skillIdOrName)}/versions/${encodeURIComponent(version)}/agentseal-rescan`,
        {},
      );
      if (res.error) {
        const isDisabled = res.error.code === "AGENTSEAL_DISABLED";
        addToast({
          type: "error",
          message: isDisabled
            ? t("agentseal.rescanDisabled", "AgentSeal scanner is not configured on this deployment")
            : (res.error.message ?? "Rescan failed"),
        });
        return;
      }
      addToast({
        type: "success",
        message: t("agentseal.rescanSuccess", "Trust score rescanned"),
      });
      onRescanned?.();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Rescan failed",
      });
    } finally {
      setRescanning(false);
    }
  }

  // Unscanned variant — keep the silhouette so the right rail doesn't
  // jolt vertically when scrolling between scanned and unscanned skills.
  if (!scan) {
    return (
      <section
        className={`card-impression rounded-md border border-subtle bg-card p-5 ${className}`}
        aria-label={t("agentseal.cardLabel", "Trust score")}
      >
        <h3 className="mb-3.5 flex items-center justify-between gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
          <span className="flex items-center gap-2">
            <ShieldIcon className="h-[11px] w-[11px]" />
            {t("agentseal.cardTitle", "Trust score")}
          </span>
          {canShowRescan && (
            <RescanButton onClick={handleRescan} loading={rescanning} />
          )}
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
        <p className="mt-4 border-t border-dashed border-subtle pt-3 font-mono text-[10px] leading-relaxed text-meta">
          {t("agentseal.attribution", "Trust auditing provided by")}{" "}
          <a
            href="https://agentseal.org"
            target="_blank"
            rel="noreferrer noopener"
            className="text-strong hover:text-accent transition-colors"
          >
            AgentSeal
          </a>
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
      <h3 className="mb-3.5 flex items-center justify-between gap-2 border-b border-dashed border-subtle pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
        <span className="flex items-center gap-2">
          <ShieldIcon className="h-[11px] w-[11px]" />
          {t("agentseal.cardTitle", "Trust score")}
        </span>
        {canShowRescan && (
          <RescanButton onClick={handleRescan} loading={rescanning} />
        )}
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

      {/* Clean-result explainer — shown only when score is perfect AND
          no findings. Tells the user what "100" actually verified. */}
      {sortedFindings.length === 0 && score === 100 && (
        <div className="mt-3 flex items-start gap-2 rounded-sm border border-success/30 bg-success-soft px-3 py-2">
          <svg
            className="mt-0.5 h-3 w-3 shrink-0 text-success"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p className="font-text text-[11px] leading-relaxed text-success">
            {t(
              "agentseal.cleanScore",
              "No malicious patterns, suspicious data flows, or known-bad hashes detected" +
                (scan.scannedFiles ? ` across ${scan.scannedFiles} scanned file${scan.scannedFiles === 1 ? "" : "s"}` : "") +
                ".",
            )}
          </p>
        </div>
      )}

      <p className="mt-3 font-mono text-[11px] leading-relaxed tracking-wide text-meta">
        {t("agentseal.scannedAt", "Scanned {{date}}", {
          date: formatDateSGT(scan.scannedAt),
        })}
        {typeof scan.scannedFiles === "number" && (
          <>
            {" · "}
            {scan.scannedFiles}{" "}
            {scan.scannedFiles === 1 ? "file" : "files"}
          </>
        )}
      </p>

      {/* Findings disclosure. Always rendered (even at zero) so the
          control is discoverable; collapsed by default. The clean state
          is success-toned to match the score band rather than ember,
          so "no findings" reads as a positive signal. */}
      <div className="mt-3.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={findingsId}
          className={`inline-flex items-center gap-1.5 self-start py-1 font-mono text-[10px] uppercase tracking-widest transition-all hover:gap-2 ${
            sortedFindings.length === 0
              ? "text-success"
              : "text-accent hover:text-accent-muted"
          }`}
        >
          {sortedFindings.length === 0 ? (
            <svg
              className="h-2.5 w-2.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : null}
          <span>
            {sortedFindings.length === 0
              ? t("agentseal.findingsClean", "Clean — 0 findings")
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

      {/* Provider attribution — keeps the footer consistent across
          scanned and unscanned variants and tells the user where the
          score came from + which rule set produced it. */}
      <p className="mt-4 border-t border-dashed border-subtle pt-3 font-mono text-[10px] leading-relaxed text-meta">
        {t("agentseal.attribution", "Trust auditing provided by")}{" "}
        <a
          href="https://agentseal.org"
          target="_blank"
          rel="noreferrer noopener"
          className="text-strong hover:text-accent transition-colors"
        >
          AgentSeal
        </a>
        {scan.version && (
          <>
            {" · "}
            {formatAgentSealVersion(scan.version)}
          </>
        )}
      </p>
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

interface RescanButtonProps {
  onClick: () => void;
  loading: boolean;
}

/** Admin-only manual rescan trigger — sits in the trust-score card header. */
function RescanButton({ onClick, loading }: RescanButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      title={t("agentseal.rescanTitle", "Re-run AgentSeal trust scan (admin)")}
      className="
        inline-flex items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/5
        px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-accent
        transition-colors duration-150 cursor-pointer
        hover:bg-accent/10 hover:border-accent
        disabled:opacity-60 disabled:cursor-progress
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
      "
    >
      <svg
        className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
      {loading
        ? t("agentseal.rescanLoading", "Scanning…")
        : t("agentseal.rescan", "Rescan")}
    </button>
  );
}

export type { AgentSealBand };
