/**
 * DashboardTile — single stat tile on the admin dashboard.
 *
 * Industrial Forge surface: card-surface body, mono uppercase label,
 * large display number. Loading shows a skeleton. Error shows a
 * `text-danger` short copy in place of the number so the tile keeps
 * its slot in the grid.
 *
 * @module components/admin/DashboardTile
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export interface DashboardTileProps {
  label: string;
  value: number | undefined;
  helper?: string;
  /** Display tone — accent for primary numbers, support for neutral. */
  tone?: "accent" | "support" | "neutral";
  isLoading?: boolean;
  errorMessage?: string | null;
  delay?: number;
  icon?: ReactNode;
}

const TONE: Record<NonNullable<DashboardTileProps["tone"]>, string> = {
  accent: "text-accent",
  support: "text-accent-support",
  neutral: "text-strong",
};

export function DashboardTile({
  label,
  value,
  helper,
  tone = "accent",
  isLoading = false,
  errorMessage,
  delay = 0,
  icon,
}: DashboardTileProps) {
  const valueColor = TONE[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
    >
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-meta">
              {label}
            </p>
            {isLoading ? (
              <div className="mt-2">
                <Skeleton lines={1} />
              </div>
            ) : errorMessage ? (
              <p
                role="alert"
                className="mt-2 font-mono text-[11px] text-danger"
              >
                {errorMessage}
              </p>
            ) : (
              <p
                className={`mt-2 font-display text-3xl font-bold tracking-tight ${valueColor}`}
              >
                {(value ?? 0).toLocaleString()}
              </p>
            )}
            {helper && !errorMessage && !isLoading && (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                {helper}
              </p>
            )}
          </div>
          {icon && (
            <div
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-subtle bg-elevated/40 text-accent"
            >
              {icon}
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
