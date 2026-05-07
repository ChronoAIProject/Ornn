/**
 * QuotaTable — admin per-user quota table for a single surface.
 *
 * One row per non-admin user with current-month columns: defaultAllotment,
 * adminGrant, used, remaining, and a per-row Grant action. Admins are
 * filtered out by the API; this component does not render them.
 *
 * @module components/admin/quota/QuotaTable
 */

import { Skeleton } from "@/components/ui/Skeleton";
import type { AdminQuotaRow, Surface } from "@/services/quotaApi";

export interface QuotaTableProps {
  rows: AdminQuotaRow[];
  surface: Surface;
  isLoading: boolean;
  errorMessage?: string | null;
  onRowClick: (row: AdminQuotaRow) => void;
  onGrantClick: (row: AdminQuotaRow) => void;
}

function nfmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function QuotaTable({
  rows,
  isLoading,
  errorMessage,
  onRowClick,
  onGrantClick,
}: QuotaTableProps) {
  if (isLoading) {
    return <Skeleton lines={8} />;
  }
  if (errorMessage) {
    return (
      <p className="py-8 text-center font-text text-danger">{errorMessage}</p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center font-text text-meta">No users match.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-accent/20">
            <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              User
            </th>
            <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Default
            </th>
            <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Admin grant
            </th>
            <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Used
            </th>
            <th className="px-4 py-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Remaining
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.userId}
              onClick={() => onRowClick(row)}
              className="cursor-pointer border-b border-accent/10 hover:bg-elevated/40"
            >
              <td className="px-4 py-3">
                <p className="font-text text-sm text-strong">
                  {row.displayName || "—"}
                </p>
                <p className="font-mono text-[11px] text-meta">{row.email}</p>
              </td>
              <td className="px-4 py-3 text-right font-mono text-[12px] text-body">
                {nfmt(row.defaultAllotment)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-[12px] text-accent">
                {row.adminGrant > 0 ? `+${nfmt(row.adminGrant)}` : "—"}
              </td>
              <td className="px-4 py-3 text-right font-mono text-[12px] text-strong">
                {nfmt(row.used)}
              </td>
              <td
                className={`px-4 py-3 text-right font-mono text-[12px] ${
                  row.remaining <= 0 ? "text-danger" : "text-strong"
                }`}
              >
                {nfmt(Math.max(0, row.remaining))}
              </td>
              <td
                className="whitespace-nowrap px-4 py-3 text-right"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => onGrantClick(row)}
                  className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent hover:text-accent-muted"
                >
                  Grant +N
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
