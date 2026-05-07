/**
 * QuotaInline — in-context surface display + soft warning banner.
 *
 * Sits at the top of the playground / skill-gen pages and renders one of
 * four states based on the cached caller quota:
 *
 *  - admin-bypass:  compact "ADMIN · UNLIMITED" stamp (admins bypass the
 *                   counter on the backend).
 *  - normal:        compact "X / Y left" stamp with reset hint.
 *  - warning:       full-width banner at the configured warning
 *                   threshold; copy directs the user to the QuotaChip
 *                   drawer for detail.
 *  - exhausted:     rendered nothing (the over-limit page takes over).
 *
 * @module components/quota/QuotaInline
 */

import type { Surface, SurfaceSnapshot } from "@/services/quotaApi";
import { useMyQuota } from "@/hooks/useQuota";

const SURFACE_LABEL: Record<Surface, string> = {
  playground: "playground",
  skillGen: "skill-gen",
};

interface QuotaInlineProps {
  surface: Surface;
  className?: string;
}

function nfmt(n: number): string {
  return n.toLocaleString("en-US");
}

function ceiling(s: SurfaceSnapshot): number {
  return s.defaultAllotment + s.adminGrant;
}

export function QuotaInline({ surface, className = "" }: QuotaInlineProps) {
  const { data: quota } = useMyQuota();
  if (!quota) return null;

  // Admin bypass — show a stable "UNLIMITED" stamp so admins still get
  // visual confirmation of their own quota state in the surface header.
  if (quota.isAdmin) {
    return (
      <span
        role="status"
        aria-label="Admin — quota unlimited"
        title="Admin · Unlimited usage"
        className={`inline-flex items-center gap-2 rounded-sm border border-accent/40 bg-accent/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-accent ${className}`}
      >
        <svg
          className="h-3 w-3 opacity-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
          <path d="M19 5v14" />
        </svg>
        <span>Admin</span>
        <span className="text-meta">·</span>
        <span>Unlimited {SURFACE_LABEL[surface]}</span>
      </span>
    );
  }
  const snap = surface === "playground" ? quota.playground : quota.skillGen;

  const cap = ceiling(snap);
  const remaining = Math.max(0, snap.remaining);
  const exhausted = remaining <= 0;
  const warning = snap.warning && !exhausted;

  if (warning) {
    return (
      <div
        role="status"
        className={`flex items-start gap-3 rounded border border-warning/40 bg-warning-soft px-4 py-3 ${className}`}
      >
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div className="flex-1">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">
            {SURFACE_LABEL[surface]} — {cap > 0 ? Math.round((snap.used / cap) * 100) : 0}% used this month
          </p>
          <p className="mt-1 font-text text-xs leading-relaxed text-body">
            {nfmt(remaining)} {SURFACE_LABEL[surface]} calls left
            {snap.adminGrant > 0
              ? ` (includes +${nfmt(snap.adminGrant)} admin grant)`
              : ""}
            . Click the quota chip in the nav for full breakdown.
          </p>
        </div>
      </div>
    );
  }

  if (exhausted) {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-sm border border-subtle bg-elevated/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta ${className}`}
    >
      <span className="text-accent">{nfmt(remaining)}</span>
      <span className="opacity-70">/{nfmt(cap)} {SURFACE_LABEL[surface]} left</span>
      {snap.adminGrant > 0 ? (
        <>
          <span className="hidden sm:inline opacity-50">·</span>
          <span className="hidden sm:inline opacity-70 text-accent-support">
            +{nfmt(snap.adminGrant)} grant
          </span>
        </>
      ) : null}
    </div>
  );
}
