/**
 * UsagePullsCard — primary "how much is this skill being used" visual on
 * `SkillDetailPage`. Renders a multi-line chart of skill-pull counts
 * over a fixed time range driven by the bucket size, broken down by
 * source (api / web / playground).
 *
 * The bucket selector also pins the visible window — there is no
 * custom date picker:
 *   - hour  → last 24 hours
 *   - day   → last 7 days
 *   - month → last 12 months
 *
 * Data shape is fed by `useSkillPulls(idOrName, { bucket, from, to,
 * version })`. Empty result → muted "no usage in this range" empty state.
 *
 * @module components/skill/UsagePullsCard
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useSkillPulls } from "@/hooks/useAnalytics";
import type { PullBucket, PullBucketCount } from "@/types/analytics";

interface UsagePullsCardProps {
  idOrName: string | undefined;
  /** Optional version filter; matches the SkillDetailPage selected version. */
  version?: string;
  className?: string;
}

const BUCKETS: ReadonlyArray<{ key: PullBucket; labelKey: string; fallback: string }> = [
  { key: "hour", labelKey: "analytics.bucketHour", fallback: "Hour" },
  { key: "day", labelKey: "analytics.bucketDay", fallback: "Day" },
  { key: "month", labelKey: "analytics.bucketMonth", fallback: "Month" },
];

/**
 * Compute the canned date range for a given bucket. Each bucket pins
 * its own window — the user no longer picks from/to.
 */
function rangeFor(bucket: PullBucket): { from: string; to: string } {
  const now = new Date();
  let fromMs: number;
  if (bucket === "hour") {
    fromMs = now.getTime() - 24 * 60 * 60 * 1000;
  } else if (bucket === "day") {
    fromMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  } else {
    fromMs = now.getTime() - 365 * 24 * 60 * 60 * 1000;
  }
  return { from: new Date(fromMs).toISOString(), to: now.toISOString() };
}

/** Pretty-print bucket timestamp based on the chosen bucket size. */
function formatBucket(iso: string, bucket: PullBucket): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (bucket === "hour") {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      hour12: false,
    });
  }
  if (bucket === "day") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

/**
 * Round an instant down to the start of its bucket in UTC. Used to
 * key both server-returned buckets and the client-generated tick
 * sequence so empty buckets line up cleanly.
 */
function bucketKey(d: Date, bucket: PullBucket): string {
  if (bucket === "hour") {
    return new Date(Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
    )).toISOString();
  }
  if (bucket === "day") {
    return new Date(Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
    )).toISOString();
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/**
 * Build the full sequence of bucket starts spanning `[from, to]`,
 * inclusive at the bucket-rounded edges. The tail (`to`) is included
 * even if it's strictly less than the next bucket boundary, so "now"
 * is always visible on the axis.
 */
function expectedBuckets(bucket: PullBucket, fromIso: string, toIso: string): string[] {
  const buckets: string[] = [];
  const start = new Date(bucketKey(new Date(fromIso), bucket));
  const endKey = bucketKey(new Date(toIso), bucket);
  let cur = start;
  // Hard cap to keep us safe from runaway loops if the inputs go sideways.
  for (let i = 0; i < 4000; i++) {
    buckets.push(cur.toISOString());
    if (cur.toISOString() === endKey) break;
    if (bucket === "hour") {
      cur = new Date(cur.getTime() + 60 * 60 * 1000);
    } else if (bucket === "day") {
      cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
    } else {
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
  }
  return buckets;
}

/**
 * Project the wire shape into recharts-friendly rows. Empty buckets
 * are padded with zeros so the x-axis spans the full window even on
 * quiet days — the user explicitly asked for "all entries present"
 * regardless of activity.
 */
function rowsFor(
  items: ReadonlyArray<PullBucketCount>,
  bucket: PullBucket,
  fromIso: string,
  toIso: string,
) {
  const byKey = new Map<string, PullBucketCount>();
  for (const p of items) {
    byKey.set(bucketKey(new Date(p.bucket), bucket), p);
  }
  return expectedBuckets(bucket, fromIso, toIso).map((iso) => {
    const p = byKey.get(iso);
    return {
      bucketLabel: formatBucket(iso, bucket),
      bucketRaw: iso,
      api: p?.bySource.api ?? 0,
      web: p?.bySource.web ?? 0,
      playground: p?.bySource.playground ?? 0,
      total: p?.total ?? 0,
    };
  });
}

/**
 * Series colors — sourced from the editorial-forge palette in
 * `DESIGN.md`. We pull live CSS custom properties so the chart re-tints
 * with the bright/dark theme switch instead of being hard-coded to one
 * mode.
 *   api        → primary accent (ember)        — north-star series
 *   web        → support accent (mustard)      — secondary visibility
 *   playground → state-info (mineral grey-blue) — neutral
 */
const SERIES_COLORS = {
  api: "var(--color-accent-primary)",
  web: "var(--color-accent-support)",
  playground: "var(--color-state-info)",
} as const;

export function UsagePullsCard({
  idOrName,
  version,
  className,
}: UsagePullsCardProps) {
  const { t } = useTranslation();
  const [bucket, setBucket] = useState<PullBucket>("day");

  // Bucket pins the window. Recompute lazily so the component doesn't
  // tick every render — only when the bucket changes (or the user opens
  // the page).
  const { from, to } = useMemo(() => rangeFor(bucket), [bucket]);

  const { data: items = [], isLoading, isError } = useSkillPulls(idOrName, {
    bucket,
    from,
    to,
    version,
  });

  const rows = useMemo(() => rowsFor(items, bucket, from, to), [items, bucket, from, to]);
  const totals = useMemo(() => {
    let api = 0;
    let web = 0;
    let pg = 0;
    for (const r of rows) {
      api += r.api;
      web += r.web;
      pg += r.playground;
    }
    return { api, web, playground: pg, total: api + web + pg };
  }, [rows]);

  if (!idOrName) return null;

  return (
    <section
      className={`rounded-xl border border-subtle bg-card p-4 ${className ?? ""}`}
    >
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-sm uppercase tracking-wider text-strong">
            {t("analytics.usageHeading", "Skill Usage")}
          </h3>
          <p className="mt-0.5 font-text text-xs text-meta">
            {t(
              "analytics.usageSubtitle",
              "Pulls over time. api = SDK / CLI / agent · web = detail-page download · playground = in-product trial.",
            )}
          </p>
        </div>
        <div className="flex overflow-hidden rounded-md border border-subtle">
          {BUCKETS.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => setBucket(b.key)}
              className={`px-3 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
                bucket === b.key
                  ? "bg-accent-soft text-accent"
                  : "text-meta hover:bg-elevated"
              }`}
            >
              {t(b.labelKey, b.fallback)}
            </button>
          ))}
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
        <span className="text-meta">
          {t("analytics.totalPulls", "Total")}:{" "}
          <span className="text-strong">{totals.total}</span>
        </span>
        <span className="text-meta">
          api: <span style={{ color: SERIES_COLORS.api }}>{totals.api}</span>
        </span>
        <span className="text-meta">
          web: <span style={{ color: SERIES_COLORS.web }}>{totals.web}</span>
        </span>
        <span className="text-meta">
          playground:{" "}
          <span style={{ color: SERIES_COLORS.playground }}>{totals.playground}</span>
        </span>
      </div>

      {isLoading ? (
        <p className="py-12 text-center font-text text-xs text-meta">
          {t("analytics.loading", "Loading analytics…")}
        </p>
      ) : isError ? (
        <p className="py-12 text-center font-text text-xs text-danger">
          {t("analytics.loadFailed", "Could not load analytics.")}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center font-text text-xs text-meta">
          {t("analytics.noUsage", "No usage in this range.")}
        </p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 12, bottom: 10, left: 0 }}>
              <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
              <XAxis
                dataKey="bucketLabel"
                tick={{ fontSize: 11, fill: "var(--color-text-meta)" }}
                axisLine={{ stroke: "var(--color-border-subtle)" }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "var(--color-text-meta)" }}
                axisLine={{ stroke: "var(--color-border-subtle)" }}
                tickLine={false}
              />
              <Tooltip
                cursor={{ stroke: "var(--color-border-strong)", strokeWidth: 1 }}
                contentStyle={{
                  background: "var(--color-surface-card)",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--color-text-strong)",
                }}
                labelStyle={{ color: "var(--color-text-meta)" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="api"
                name="api"
                stroke={SERIES_COLORS.api}
                strokeWidth={2}
                dot={{ r: 3, fill: SERIES_COLORS.api }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="web"
                name="web"
                stroke={SERIES_COLORS.web}
                strokeWidth={2}
                dot={{ r: 3, fill: SERIES_COLORS.web }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="playground"
                name="playground"
                stroke={SERIES_COLORS.playground}
                strokeWidth={2}
                dot={{ r: 3, fill: SERIES_COLORS.playground }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
