/**
 * UsagePullsCard — primary "how much is this skill being used" visual on
 * `SkillDetailPage`. Renders a stacked bar chart of skill-pull counts
 * over a user-controlled time range and bucket size, broken down by
 * source (api / web / playground).
 *
 * Data shape is fed by `useSkillPulls(idOrName, { bucket, from, to,
 * version })`. Empty result → muted "no pulls in this range" empty state.
 *
 * @module components/skill/UsagePullsCard
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
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

/** ISO-truncate a Date to `YYYY-MM-DDTHH:mm` so an `<input type=datetime-local>` accepts it. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

/** Convert the local-input string back into an ISO-8601 instant. */
function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** Default range: last 7 days, ending now. */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: toLocalInput(from), to: toLocalInput(now) };
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

/** Project the wire shape into recharts-friendly rows: { bucketLabel, api, web, playground }. */
function rowsFor(items: ReadonlyArray<PullBucketCount>, bucket: PullBucket) {
  return items.map((p) => ({
    bucketLabel: formatBucket(p.bucket, bucket),
    bucketRaw: p.bucket,
    api: p.bySource.api ?? 0,
    web: p.bySource.web ?? 0,
    playground: p.bySource.playground ?? 0,
    total: p.total,
  }));
}

export function UsagePullsCard({
  idOrName,
  version,
  className,
}: UsagePullsCardProps) {
  const { t } = useTranslation();
  const [bucket, setBucket] = useState<PullBucket>("day");
  const [{ from, to }, setRange] = useState<{ from: string; to: string }>(
    defaultRange,
  );

  const fromIso = fromLocalInput(from);
  const toIso = fromLocalInput(to);
  const valid = !!fromIso && !!toIso && new Date(fromIso) < new Date(toIso);

  const { data: items = [], isLoading, isError } = useSkillPulls(idOrName, {
    bucket,
    from: valid ? fromIso : undefined,
    to: valid ? toIso : undefined,
    version,
  });

  const rows = useMemo(() => rowsFor(items, bucket), [items, bucket]);
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
      className={`glass rounded-xl border border-neon-cyan/15 p-4 ${className ?? ""}`}
    >
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-heading text-sm uppercase tracking-wider text-text-primary">
            {t("analytics.pullsHeading", "Skill pulls")}
          </h3>
          <p className="mt-0.5 font-body text-xs text-text-muted">
            {t(
              "analytics.pullsSubtitle",
              "Stacked by source. api = SDK / CLI / agent · web = detail-page download · playground = in-product trial.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex overflow-hidden rounded-md border border-neon-cyan/20">
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setBucket(b.key)}
                className={`px-3 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
                  bucket === b.key
                    ? "bg-neon-cyan/15 text-neon-cyan"
                    : "text-text-muted hover:bg-neon-cyan/5"
                }`}
              >
                {t(b.labelKey, b.fallback)}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-heading text-[10px] uppercase tracking-wider text-text-muted">
              {t("analytics.from", "From")}
            </span>
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="rounded border border-neon-cyan/20 bg-bg-surface px-2 py-1 font-mono text-xs text-text-primary focus:outline-none focus:border-neon-cyan/60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-heading text-[10px] uppercase tracking-wider text-text-muted">
              {t("analytics.to", "To")}
            </span>
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="rounded border border-neon-cyan/20 bg-bg-surface px-2 py-1 font-mono text-xs text-text-primary focus:outline-none focus:border-neon-cyan/60"
            />
          </label>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
        <span className="text-text-muted">
          {t("analytics.totalPulls", "Total")}:{" "}
          <span className="text-text-primary">{totals.total}</span>
        </span>
        <span className="text-text-muted">api: <span className="text-neon-cyan">{totals.api}</span></span>
        <span className="text-text-muted">web: <span className="text-neon-yellow">{totals.web}</span></span>
        <span className="text-text-muted">playground: <span className="text-neon-magenta">{totals.playground}</span></span>
      </div>

      {!valid ? (
        <p className="py-12 text-center font-body text-xs text-neon-red">
          {t("analytics.invalidRange", "Invalid range — 'from' must be earlier than 'to'.")}
        </p>
      ) : isLoading ? (
        <p className="py-12 text-center font-body text-xs text-text-muted">
          {t("analytics.loading", "Loading analytics…")}
        </p>
      ) : isError ? (
        <p className="py-12 text-center font-body text-xs text-neon-red">
          {t("analytics.loadFailed", "Could not load analytics.")}
        </p>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center font-body text-xs text-text-muted">
          {t("analytics.noPulls", "No pulls recorded in this range.")}
        </p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 10, right: 12, bottom: 10, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey="bucketLabel"
                tick={{ fontSize: 11, fill: "currentColor" }}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                tickLine={false}
                className="text-text-muted"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "currentColor" }}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                tickLine={false}
                className="text-text-muted"
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{
                  background: "rgba(20, 24, 32, 0.96)",
                  border: "1px solid rgba(0, 255, 255, 0.25)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#cbd5e1" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="api" name="api" stackId="src" fill="#22d3ee" />
              <Bar dataKey="web" name="web" stackId="src" fill="#facc15" />
              <Bar dataKey="playground" name="playground" stackId="src" fill="#f472b6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
