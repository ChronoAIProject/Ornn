/**
 * CalendarPeriodBanner — header strip on the admin Quota page that
 * shows which UTC calendar month the table rows describe. Reading the
 * label is the first thing an admin should do before interpreting any
 * "used / remaining" cell, so the banner sits above tabs.
 *
 * @module components/admin/quota/CalendarPeriodBanner
 */

interface CalendarPeriodBannerProps {
  /** ISO datetime, inclusive — first millisecond of the month (UTC). */
  monthStart: string;
  /** ISO datetime, exclusive — first millisecond of the next month (UTC). */
  monthEnd: string;
  className?: string;
}

function fmt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function CalendarPeriodBanner({
  monthStart,
  monthEnd,
  className = "",
}: CalendarPeriodBannerProps) {
  return (
    <div
      role="status"
      aria-label="Current quota period"
      className={`inline-flex items-center gap-3 rounded border border-subtle bg-elevated/40 px-4 py-2 ${className}`}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
        Period
      </span>
      <span className="font-mono text-xs uppercase tracking-[0.14em] text-strong">
        {fmt(monthStart)} → {fmt(monthEnd)}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-support">
        UTC
      </span>
    </div>
  );
}
