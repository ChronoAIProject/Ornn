/**
 * QuotaSummary — drawer showing the full quota breakdown across both
 * surfaces. Opened from the QuotaChip in the top nav.
 *
 * Layout per surface: monthly bar with used / limit, daily ceiling
 * sub-bar, credit balance line, next reset times. A single CTA at the
 * bottom directs the user to the admin contact / paid-plan upsell.
 *
 * @module components/quota/QuotaSummary
 */

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import type { QuotaSnapshot, SurfaceSnapshot } from "@/services/quotaApi";

const SURFACE_LABEL: Record<"playground" | "skillGen", string> = {
  playground: "Playground",
  skillGen: "Skill Generation",
};

function nfmt(n: number): string {
  return n.toLocaleString("en-US");
}

function formatReset(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}

interface SurfaceRowProps {
  label: string;
  snapshot: SurfaceSnapshot;
}

function SurfaceRow({ label, snapshot }: SurfaceRowProps) {
  const monthlyPct = pct(snapshot.monthly.used, snapshot.monthly.limit);
  const dailyPct = pct(snapshot.daily.used, snapshot.daily.limit);
  const monthlyTone =
    snapshot.monthly.remaining <= 0
      ? "bg-danger"
      : snapshot.warning
      ? "bg-warning"
      : "bg-accent";
  const totalRemaining = snapshot.monthly.remaining + snapshot.credits.balance;

  return (
    <section className="rounded border border-subtle bg-elevated/40 p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-strong">
          {label}
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
          {nfmt(totalRemaining)} remaining
        </span>
      </header>

      <dl className="space-y-3">
        <div>
          <div className="mb-1 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.14em]">
            <dt className="text-meta">Monthly base</dt>
            <dd className="text-strong">
              <span className="text-meta">{nfmt(snapshot.monthly.used)} /</span>{" "}
              {nfmt(snapshot.monthly.limit)}
            </dd>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-sm bg-card">
            <div
              className={`h-full transition-all duration-300 ${monthlyTone}`}
              style={{ width: `${monthlyPct}%` }}
            />
          </div>
          <p className="mt-1 font-mono text-[10px] text-meta">
            Resets {formatReset(snapshot.monthlyResetAt)}
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.14em]">
            <dt className="text-meta">Daily ceiling</dt>
            <dd className="text-strong">
              <span className="text-meta">{nfmt(snapshot.daily.used)} /</span>{" "}
              {nfmt(snapshot.daily.limit)}
            </dd>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-sm bg-card">
            <div
              className="h-full bg-accent-support transition-all duration-300"
              style={{ width: `${dailyPct}%` }}
            />
          </div>
          <p className="mt-1 font-mono text-[10px] text-meta">
            Resets {formatReset(snapshot.dailyResetAt)}
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-subtle pt-3 font-mono text-[11px]">
          <dt className="uppercase tracking-[0.14em] text-meta">
            Beta credits
          </dt>
          <dd className="text-accent">+{nfmt(snapshot.credits.balance)}</dd>
        </div>
      </dl>
    </section>
  );
}

export interface QuotaSummaryProps {
  isOpen: boolean;
  onClose: () => void;
  quota: QuotaSnapshot;
}

export function QuotaSummary({ isOpen, onClose, quota }: QuotaSummaryProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 240, damping: 28, mass: 0.9 }}
            role="dialog"
            aria-label="Quota usage details"
            className="card-impression absolute right-0 top-0 flex h-full w-full max-w-md flex-col gap-5 border-l border-subtle bg-page p-6 sm:p-8"
          >
            <header className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  [§ QUOTA — USAGE]
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-strong">
                  Your usage this period
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 -mt-2 inline-flex h-8 w-8 items-center justify-center rounded-sm text-meta transition-colors hover:bg-elevated hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto">
              <SurfaceRow label={SURFACE_LABEL.playground} snapshot={quota.playground} />
              <SurfaceRow label={SURFACE_LABEL.skillGen} snapshot={quota.skillGen} />
            </div>

            <footer className="rounded border border-accent/30 bg-accent/5 p-4">
              <p className="font-text text-sm text-strong">
                Need more headroom?
              </p>
              <p className="mt-1 font-text text-xs leading-relaxed text-body">
                Beta credits are non-expiring and granted by an Ornn admin.
                Paid plans are coming soon.
              </p>
              <a
                href="mailto:hello@chrono-ai.fun?subject=Ornn%20beta%20credits"
                className="mt-3 inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-accent hover:text-accent-muted"
              >
                Contact admin
                <span aria-hidden>→</span>
              </a>
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
