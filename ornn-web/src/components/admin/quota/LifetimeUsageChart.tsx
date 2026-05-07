/**
 * LifetimeUsageChart — single-surface monthly usage history for one user.
 *
 * Recharts `BarChart`, single forge-accent series, mono uppercase axis
 * labels. `staleTime` is enforced at the hook layer (5 minutes) so the
 * chart doesn't thrash when the drawer is opened repeatedly.
 *
 * @module components/admin/quota/LifetimeUsageChart
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LifetimeBucket } from "@/services/quotaApi";

interface LifetimeUsageChartProps {
  items: LifetimeBucket[];
  /** Optional fill color override for storybook; default reads forge accent CSS var. */
  color?: string;
  height?: number;
}

interface ChartDatum {
  month: string;
  used: number;
  ceiling: number;
}

function toData(items: LifetimeBucket[]): ChartDatum[] {
  return items.map((b) => ({
    month: b.monthMarker,
    used: b.used,
    ceiling: b.defaultAllotment + b.adminGrant,
  }));
}

const TICK = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 10,
  fill: "var(--color-meta)",
};

export function LifetimeUsageChart({
  items,
  color = "var(--color-accent)",
  height = 220,
}: LifetimeUsageChartProps) {
  if (items.length === 0) {
    return (
      <div
        role="status"
        aria-label="No lifetime usage history"
        className="flex h-[220px] items-center justify-center rounded border border-dashed border-subtle bg-elevated/30 font-mono text-[11px] uppercase tracking-[0.14em] text-meta"
      >
        No usage history yet
      </div>
    );
  }

  const data = toData(items);
  return (
    <div role="img" aria-label="Lifetime monthly usage" style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-subtle)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="month" tick={TICK} stroke="var(--color-meta)" />
          <YAxis tick={TICK} stroke="var(--color-meta)" allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "var(--color-elevated)" }}
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-subtle)",
              borderRadius: 4,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              color: "var(--color-strong)",
            }}
          />
          <Bar dataKey="used" fill={color} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
