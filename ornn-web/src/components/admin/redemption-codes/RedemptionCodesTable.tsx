/**
 * RedemptionCodesTable — admin list of minted codes.
 *
 * Columns: Code (mono + copy), Grants (chips), Expires, Created by,
 * Status badge, Actions. Row click opens the detail drawer; the
 * Invalidate action is row-only on `active` rows.
 *
 * @module components/admin/redemption-codes/RedemptionCodesTable
 */

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import type {
  RedemptionCode,
  RedemptionCodeStatus,
  RedemptionGrantEntry,
  Surface,
} from "@/services/redemptionCodesApi";

const SURFACE_LABEL: Record<Surface, string> = {
  playground: "Playground",
  skillGen: "Skill generation",
};

const STATUS_BADGE: Record<
  RedemptionCodeStatus,
  { color: "cyan" | "green" | "muted" | "red"; label: string }
> = {
  active: { color: "cyan", label: "Active" },
  redeemed: { color: "green", label: "Redeemed" },
  invalidated: { color: "muted", label: "Invalidated" },
};

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function GrantChips({ grants }: { grants: RedemptionGrantEntry[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {grants.map((g) => (
        <Badge key={g.surface} color="magenta">
          {SURFACE_LABEL[g.surface]} +{g.amount.toLocaleString("en-US")}
        </Badge>
      ))}
    </div>
  );
}

function CodeCell({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard refusal: silent — hover state still surfaces the code
    }
  };
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[12px] text-strong">{code}</span>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy code"
        className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta hover:text-accent"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export interface RedemptionCodesTableProps {
  rows: RedemptionCode[];
  isLoading: boolean;
  errorMessage?: string | null;
  invalidatingId?: string | null;
  onRowClick: (code: RedemptionCode) => void;
  onInvalidateClick: (code: RedemptionCode) => void;
}

export function RedemptionCodesTable({
  rows,
  isLoading,
  errorMessage,
  invalidatingId,
  onRowClick,
  onInvalidateClick,
}: RedemptionCodesTableProps) {
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
      <p className="py-8 text-center font-text text-meta">
        No redemption codes match.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-accent/20">
            <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Code
            </th>
            <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Grants
            </th>
            <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Expires
            </th>
            <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Created by
            </th>
            <th className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Status
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const statusMeta = STATUS_BADGE[row.status];
            const canInvalidate = row.status === "active";
            const tooltip = canInvalidate
              ? undefined
              : "Cannot invalidate redeemed/invalidated codes";
            const isThisInvalidating = invalidatingId === row.id;
            return (
              <tr
                key={row.id}
                onClick={() => onRowClick(row)}
                className="cursor-pointer border-b border-accent/10 hover:bg-elevated/40"
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <CodeCell code={row.code} />
                </td>
                <td className="px-4 py-3">
                  <GrantChips grants={row.grants} />
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-body">
                  {formatDateTime(row.expiresAt)}
                </td>
                <td className="px-4 py-3">
                  <p className="font-text text-sm text-strong">
                    {row.createdBy.displayName || row.createdBy.email}
                  </p>
                  <p className="font-mono text-[11px] text-meta">
                    {row.createdBy.email}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <Badge color={statusMeta.color}>{statusMeta.label}</Badge>
                </td>
                <td
                  className="whitespace-nowrap px-4 py-3 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    title={tooltip}
                    aria-label="Invalidate code"
                    disabled={!canInvalidate || isThisInvalidating}
                    onClick={() => onInvalidateClick(row)}
                    className={`font-mono text-[11px] uppercase tracking-[0.14em] ${
                      canInvalidate
                        ? "text-danger hover:text-danger/80"
                        : "cursor-not-allowed text-meta/60"
                    } ${isThisInvalidating ? "opacity-60" : ""}`}
                  >
                    {isThisInvalidating ? "Invalidating…" : "Invalidate"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
