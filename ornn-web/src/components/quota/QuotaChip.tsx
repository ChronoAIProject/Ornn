/**
 * QuotaChip — ambient quota counter pill in the top nav.
 *
 * Shows the playground surface's remaining count by default (the
 * higher-volume surface). Click to open the QuotaSummary drawer with
 * the full breakdown across both surfaces. Hidden for admins (they
 * bypass the counter entirely) and for anonymous callers.
 *
 * The chip turns warning-toned when the playground surface crosses the
 * 80% threshold and danger-toned at zero. This visual state is kept in
 * lockstep with the soft-warning banner / over-limit page so the user
 * sees one consistent signal across the app.
 *
 * @module components/quota/QuotaChip
 */

import { useState } from "react";
import { useMyQuota } from "@/hooks/useQuota";
import { QuotaSummary } from "./QuotaSummary";

function nfmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function QuotaChip({ className = "" }: { className?: string }) {
  const { data: quota } = useMyQuota();
  const [open, setOpen] = useState(false);

  if (!quota) return null;
  if (quota.isAdmin) return null;

  const playground = quota.playground;
  const remaining = playground.monthly.remaining + playground.credits.balance;
  const tone =
    remaining <= 0 ? "danger" : playground.warning ? "warning" : "ok";

  const toneClass =
    tone === "danger"
      ? "border-danger/50 text-danger hover:border-danger"
      : tone === "warning"
      ? "border-warning/50 text-warning hover:border-warning"
      : "border-strong-edge text-strong hover:border-accent";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quota usage details"
        className={`
          group inline-flex h-9 items-center gap-2 rounded-sm border bg-transparent
          px-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]
          transition-colors duration-200
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
          ${toneClass}
          ${className}
        `}
      >
        <svg
          className="h-3.5 w-3.5 shrink-0 opacity-80"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2v4M5 8l2.5 2.5M2 16h4M19 8l-2.5 2.5M22 16h-4" />
          <circle cx="12" cy="16" r="6" />
          <path d="M12 13v3l2 1" />
        </svg>
        <span>{nfmt(Math.max(0, remaining))}</span>
        <span className="text-meta">/{nfmt(playground.monthly.limit)}</span>
      </button>

      <QuotaSummary isOpen={open} onClose={() => setOpen(false)} quota={quota} />
    </>
  );
}
