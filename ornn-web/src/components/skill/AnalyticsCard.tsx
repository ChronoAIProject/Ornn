/**
 * Per-skill analytics card for `SkillDetailPage`.
 *
 * Renders execution count, success rate, p50/p95 latency, unique users,
 * outcome breakdown, and top error codes for a chosen rolling window
 * (7d / 30d / all). Gracefully shows an empty state for skills that
 * haven't been invoked yet.
 *
 * @module components/skill/AnalyticsCard
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSkillAnalytics } from "@/hooks/useAnalytics";
import type { AnalyticsWindow } from "@/types/analytics";

const WINDOWS: ReadonlyArray<{ key: AnalyticsWindow; labelKey: string; fallback: string }> = [
  { key: "7d", labelKey: "analytics.window7d", fallback: "7d" },
  { key: "30d", labelKey: "analytics.window30d", fallback: "30d" },
  { key: "all", labelKey: "analytics.windowAll", fallback: "All time" },
];

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)} s`;
  return `${Math.round(ms)} ms`;
}

function formatPercent(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(rate >= 0.995 ? 0 : 1)}%`;
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div>
      <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-0.5">
        {label}
      </p>
      <p className="font-heading text-lg text-text-primary leading-tight">{value}</p>
      {hint && <p className="font-body text-xs text-text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

interface AnalyticsCardProps {
  idOrName: string | undefined;
  className?: string;
}

export function AnalyticsCard({ idOrName, className }: AnalyticsCardProps) {
  const { t } = useTranslation();
  const [windowChoice, setWindowChoice] = useState<AnalyticsWindow>("30d");
  const { data, isLoading, isError } = useSkillAnalytics(idOrName, windowChoice);

  if (!idOrName) return null;

  const showEmpty = !isLoading && !isError && data && data.executionCount === 0;

  return (
    <div className={`glass rounded-xl p-5 space-y-4 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
          {t("analytics.heading", "Usage")}
        </p>
        <div className="flex overflow-hidden rounded-md border border-neon-cyan/20">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindowChoice(w.key)}
              className={`px-2 py-0.5 font-mono text-[11px] transition-colors cursor-pointer ${
                windowChoice === w.key
                  ? "bg-neon-cyan/15 text-neon-cyan"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {t(w.labelKey, w.fallback)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="font-body text-sm text-text-muted">{t("analytics.loading", "Loading…")}</p>
      ) : isError ? (
        <p className="font-body text-sm text-neon-red">
          {t("analytics.loadFailed", "Could not load analytics.")}
        </p>
      ) : !data ? (
        <p className="font-body text-sm text-text-muted">
          {t("analytics.unavailable", "Analytics unavailable for this skill.")}
        </p>
      ) : showEmpty ? (
        <p className="font-body text-sm text-text-muted">
          {t(
            "analytics.empty",
            "No executions recorded in this window yet.",
          )}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat
              label={t("analytics.executions", "Executions")}
              value={data.executionCount.toLocaleString()}
              hint={
                data.uniqueUsers > 0
                  ? t("analytics.uniqueUsers", "{{count}} unique users", {
                      count: data.uniqueUsers,
                    })
                  : undefined
              }
            />
            <Stat
              label={t("analytics.successRate", "Success rate")}
              value={formatPercent(data.successRate)}
              hint={t("analytics.outcomeBreakdown", "{{ok}} ok · {{fail}} fail · {{to}} timeout", {
                ok: data.successCount,
                fail: data.failureCount,
                to: data.timeoutCount,
              })}
            />
            <Stat
              label={t("analytics.p50", "p50 latency")}
              value={formatMs(data.latencyMs.p50)}
            />
            <Stat
              label={t("analytics.p95", "p95 latency")}
              value={formatMs(data.latencyMs.p95)}
              hint={
                data.latencyMs.p99 !== null
                  ? t("analytics.p99Hint", "p99 {{value}}", {
                      value: formatMs(data.latencyMs.p99),
                    })
                  : undefined
              }
            />
          </div>

          {data.topErrorCodes.length > 0 && (
            <div>
              <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-1.5">
                {t("analytics.topErrors", "Top errors")}
              </p>
              <ul className="space-y-1">
                {data.topErrorCodes.slice(0, 5).map((e) => (
                  <li
                    key={e.code}
                    className="flex items-center justify-between gap-3 rounded-md border border-neon-red/20 bg-neon-red/5 px-2 py-1"
                  >
                    <span className="font-mono text-xs text-neon-red truncate">{e.code}</span>
                    <span className="font-mono text-xs text-text-muted shrink-0">
                      ×{e.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
