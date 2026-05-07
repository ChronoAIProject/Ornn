/**
 * QuotaUserDetailDrawer — 480px right slide-in showing a single user's
 * current-month surface usage by model + a lifetime monthly chart.
 *
 * Pattern follows QuotaSummary (caller drawer) for consistency: dark
 * backdrop, spring slide. Pulls lifetime data via `useUserLifetimeQuota`
 * with TanStack Query `staleTime: 5 * 60 * 1000` so reopening on the
 * same user is instant.
 *
 * @module components/admin/quota/QuotaUserDetailDrawer
 */

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { LifetimeUsageChart } from "./LifetimeUsageChart";
import { useUserLifetimeQuota } from "@/hooks/useQuota";
import type { AdminQuotaRow, LifetimeBucket, Surface } from "@/services/quotaApi";

const SURFACE_LABEL: Record<Surface, string> = {
  playground: "Playground",
  skillGen: "Skill Generation",
};

export interface QuotaUserDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  surface: Surface;
  row: AdminQuotaRow | null;
  onGrantClick: (row: AdminQuotaRow) => void;
}

function nfmt(n: number): string {
  return n.toLocaleString("en-US");
}

function formatJoined(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

function CurrentMonthByModel({
  bucket,
}: {
  bucket: LifetimeBucket | undefined;
}) {
  if (!bucket) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
        No usage this month yet
      </p>
    );
  }
  const entries = Object.entries(bucket.usedByModel ?? {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
        No usage this month yet
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {entries.map(([model, count]) => (
        <li
          key={model}
          className="flex items-baseline justify-between rounded-sm border border-subtle bg-elevated/40 px-3 py-1.5 font-mono text-[11px]"
        >
          <span className="truncate text-body" title={model}>
            {model || "(unspecified)"}
          </span>
          <span className="text-strong">{nfmt(count)}</span>
        </li>
      ))}
    </ul>
  );
}

export function QuotaUserDetailDrawer({
  isOpen,
  onClose,
  surface,
  row,
  onGrantClick,
}: QuotaUserDetailDrawerProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const lifetime = useUserLifetimeQuota({
    userId: isOpen ? row?.userId ?? null : null,
    surface,
    enabled: isOpen,
  });

  const currentBucket = lifetime.data?.items.find(
    (b) => b.monthMarker === lifetime.data?.currentMonthMarker,
  );

  return createPortal(
    <AnimatePresence>
      {isOpen && row && (
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
            aria-label={`${row.email} — ${SURFACE_LABEL[surface]} quota detail`}
            className="card-impression absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col gap-5 border-l border-subtle bg-page p-6 sm:p-8"
          >
            <header className="flex items-baseline justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                  [§ {SURFACE_LABEL[surface].toUpperCase()} — DETAIL]
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-strong">
                  {row.displayName || row.email}
                </h2>
                <p className="font-mono text-[11px] text-meta">{row.email}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                  Joined {formatJoined(lifetime.data?.firstJoinedAt ?? null)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 -mt-2 inline-flex h-8 w-8 items-center justify-center rounded-sm text-meta transition-colors hover:bg-elevated hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            <div className="flex flex-wrap gap-3">
              <Stat label="Default" value={nfmt(row.defaultAllotment)} />
              <Stat label="Admin grant" value={`+${nfmt(row.adminGrant)}`} accent />
              <Stat label="Used" value={nfmt(row.used)} />
              <Stat label="Remaining" value={nfmt(Math.max(0, row.remaining))} />
            </div>

            <section>
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                Current month — by model
              </h3>
              {lifetime.isLoading ? (
                <Skeleton lines={3} />
              ) : (
                <CurrentMonthByModel bucket={currentBucket} />
              )}
            </section>

            <section className="flex-1">
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                Lifetime monthly usage
              </h3>
              {lifetime.isLoading ? (
                <Skeleton lines={5} />
              ) : lifetime.error ? (
                <p
                  role="alert"
                  className="rounded border border-danger/40 bg-danger-soft px-3 py-2 font-mono text-[11px] text-danger"
                >
                  Failed to load history.
                </p>
              ) : (
                <LifetimeUsageChart items={lifetime.data?.items ?? []} />
              )}
            </section>

            <footer className="rounded border border-accent/30 bg-accent/5 p-4">
              <p className="font-text text-xs leading-relaxed text-body">
                Admin users bypass quota — this drawer only renders for
                non-admin recipients.
              </p>
              <button
                type="button"
                onClick={() => onGrantClick(row)}
                className="mt-3 inline-flex items-center gap-2 rounded-sm border border-accent-muted bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-page hover:bg-accent-muted"
              >
                Grant +N
              </button>
            </footer>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex-1 min-w-[110px] rounded border border-subtle bg-elevated/40 p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-lg font-bold ${
          accent ? "text-accent" : "text-strong"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
