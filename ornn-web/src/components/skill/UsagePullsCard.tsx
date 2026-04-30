/**
 * UsagePullsCard — primary "how much is this skill being used" visual on
 * `SkillDetailPage`. Renders a 4-line chart of skill-pull counts over a
 * fixed time range driven by the bucket size, broken down by source
 * (total / api / web / playground). Empty buckets are padded with zeros
 * so every line is continuous through quiet days — DESIGN.md prefers
 * the "always show the line" pattern over scattered dots.
 *
 * Hover on a legend entry highlights that series (thicker stroke, full
 * opacity) and dims the others; values for the hovered series are
 * labeled at every tick so overlapping zero baselines stay readable.
 *
 * The bucket selector also pins the visible window — there is no
 * custom date picker:
 *   - hour  → last 24 hours
 *   - day   → last 7 days
 *   - month → last 12 months
 *
 * @module components/skill/UsagePullsCard
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LineChart,
  Line,
  LabelList,
  XAxis,
  YAxis,
  Tooltip,
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

type SeriesKey = "total" | "api" | "web" | "playground";

/**
 * Series colors — sourced from the Forge Workshop palette in `DESIGN.md`,
 * pulled live via CSS custom properties so the chart re-tints with the
 * bright/dark theme switch instead of being hard-coded.
 *   total      → strong ink/parchment — north-star aggregate
 *   api        → arc-blue (welding light) — primary integration channel
 *   web        → mineral success — UI-driven downloads
 *   playground → brass warning — in-product trial
 */
const SERIES: ReadonlyArray<{ key: SeriesKey; color: string }> = [
  { key: "total", color: "var(--color-strong)" },
  { key: "api", color: "var(--color-accent-secondary)" },
  { key: "web", color: "var(--color-success)" },
  { key: "playground", color: "var(--color-warning)" },
];

const SERIES_COLOR: Record<SeriesKey, string> = SERIES.reduce(
  (acc, s) => {
    acc[s.key] = s.color;
    return acc;
  },
  {} as Record<SeriesKey, string>,
);

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

/** Round an instant down to the start of its bucket in UTC. */
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
 * Build the full sequence of bucket starts spanning `[from, to]`.
 * Hard cap to keep us safe from runaway loops if the inputs go sideways.
 */
function expectedBuckets(bucket: PullBucket, fromIso: string, toIso: string): string[] {
  const buckets: string[] = [];
  const start = new Date(bucketKey(new Date(fromIso), bucket));
  const endKey = bucketKey(new Date(toIso), bucket);
  let cur = start;
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
 * are padded with zeros so every line stays continuous across the
 * full window — the user explicitly asked for "all entries present,
 * even at zero, connect them with a line."
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
    const api = p?.bySource.api ?? 0;
    const web = p?.bySource.web ?? 0;
    const playground = p?.bySource.playground ?? 0;
    return {
      bucketLabel: formatBucket(iso, bucket),
      bucketRaw: iso,
      api,
      web,
      playground,
      total: p?.total ?? api + web + playground,
    };
  });
}

export function UsagePullsCard({
  idOrName,
  version,
  className,
}: UsagePullsCardProps) {
  const { t } = useTranslation();
  /** Bucket the user has selected. Drives the query immediately. */
  const [bucket, setBucket] = useState<PullBucket>("hour");
  /** Which series the user is currently hovering on the legend. null = none. */
  const [hovered, setHovered] = useState<SeriesKey | null>(null);

  const { from, to } = useMemo(() => rangeFor(bucket), [bucket]);

  const { data: items, isLoading, isError, isFetching } = useSkillPulls(idOrName, {
    bucket,
    from,
    to,
    version,
  });

  /**
   * Rendered frame — the chart actually draws this. We only commit a new
   * frame after the query for the new bucket has settled, so switching
   * Hour ⇄ Day ⇄ Month never blanks the chart in the middle. The
   * `useSkillPulls` hook is configured with `placeholderData:
   * keepPreviousData`, so `items` stays stable across the transition;
   * the gating below makes sure we don't recompute rows under a new
   * bucket / window mismatched with that data.
   */
  const [frame, setFrame] = useState<{
    bucket: PullBucket;
    from: string;
    to: string;
    items: ReadonlyArray<PullBucketCount>;
  } | null>(null);

  useEffect(() => {
    if (isFetching) return; // wait for the new bucket's data to arrive
    if (!items) return;
    setFrame({ bucket, from, to, items });
  }, [items, isFetching, bucket, from, to]);

  const rows = useMemo(
    () =>
      frame ? rowsFor(frame.items, frame.bucket, frame.from, frame.to) : [],
    [frame],
  );
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

  /** Stroke opacity: full when un-hovered or hovered; dimmed when another is hovered. */
  const strokeOpacity = (key: SeriesKey) =>
    hovered === null || hovered === key ? 1 : 0.18;
  /** Stroke width: thicker for the hovered series. */
  const strokeWidth = (key: SeriesKey) => (hovered === key ? 3 : 2);

  return (
    <section
      className={`rounded border border-subtle bg-card p-4 ${className ?? ""}`}
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
                  ? "bg-accent/15 text-accent"
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
          <span style={{ color: SERIES_COLOR.total }}>{totals.total}</span>
        </span>
        <span className="text-meta">
          api: <span style={{ color: SERIES_COLOR.api }}>{totals.api}</span>
        </span>
        <span className="text-meta">
          web: <span style={{ color: SERIES_COLOR.web }}>{totals.web}</span>
        </span>
        <span className="text-meta">
          playground:{" "}
          <span style={{ color: SERIES_COLOR.playground }}>{totals.playground}</span>
        </span>
      </div>

      {/* Initial-load gate. Once a frame exists we keep rendering the
          chart even while the next bucket fetches — `frame` only
          re-commits after `isFetching` settles, so the previous chart
          stays on screen instead of flashing through a loading state. */}
      {frame === null && isLoading ? (
        <p className="py-12 text-center font-text text-xs text-meta">
          {t("analytics.loading", "Loading analytics…")}
        </p>
      ) : frame === null && isError ? (
        <p className="py-12 text-center font-text text-xs text-danger">
          {t("analytics.loadFailed", "Could not load analytics.")}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center font-text text-xs text-meta">
          {t("analytics.noUsage", "No usage in this range.")}
        </p>
      ) : (
        <>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 18, right: 12, bottom: 10, left: 0 }}>
                <CartesianGrid stroke="var(--color-border-subtle)" vertical={false} />
                <XAxis
                  dataKey="bucketLabel"
                  tick={{ fontSize: 11, fill: "var(--color-meta)" }}
                  axisLine={{ stroke: "var(--color-border-subtle)" }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "var(--color-meta)" }}
                  axisLine={{ stroke: "var(--color-border-subtle)" }}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ stroke: "var(--color-border-strong)", strokeWidth: 1 }}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border-strong)",
                    borderRadius: 4,
                    fontSize: 12,
                    color: "var(--color-strong)",
                    boxShadow: "var(--card-shadow-rest)",
                  }}
                  labelStyle={{ color: "var(--color-meta)", marginBottom: 4 }}
                  itemSorter={(a) => {
                    // Pin total on top, then api / web / playground.
                    const order: Record<string, number> = {
                      total: 0, api: 1, web: 2, playground: 3,
                    };
                    return order[a.dataKey as string] ?? 99;
                  }}
                />
                {/* Order: total drawn last so it sits on top of the others
                    when they share a baseline value. */}
                {SERIES.slice().reverse().map(({ key, color }) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stroke={color}
                    strokeWidth={strokeWidth(key)}
                    strokeOpacity={strokeOpacity(key)}
                    dot={{ r: 3, fill: color, strokeWidth: 0, fillOpacity: strokeOpacity(key) }}
                    activeDot={{ r: 5, strokeWidth: 0 }}
                    isAnimationActive={false}
                  >
                    {hovered === key && (
                      <LabelList
                        dataKey={key}
                        position="top"
                        offset={8}
                        style={{
                          fill: "var(--color-strong)",
                          fontSize: 10,
                          fontFamily: "JetBrains Mono, ui-monospace, monospace",
                        }}
                      />
                    )}
                  </Line>
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Custom legend — hover to highlight a series + reveal its
              per-tick values. Acts as the only legend (Recharts <Legend>
              is intentionally omitted to keep this the single source of
              hover state). */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 font-mono text-xs">
            {SERIES.map(({ key, color }) => {
              const isHovered = hovered === key;
              const dim = hovered !== null && !isHovered;
              return (
                <button
                  key={key}
                  type="button"
                  onMouseEnter={() => setHovered(key)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(key)}
                  onBlur={() => setHovered(null)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition-opacity ${
                    dim ? "opacity-40" : "opacity-100"
                  } ${isHovered ? "bg-elevated" : ""}`}
                  aria-pressed={isHovered}
                >
                  <span
                    aria-hidden
                    className="inline-block h-[3px] w-5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span style={{ color }}>{key}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
