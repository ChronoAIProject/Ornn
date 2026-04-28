/**
 * Badge — Editorial Forge stamp / micro-label.
 *
 * Mono uppercase, 2px radius, hairline border, soft tinted background.
 * Color names are the legacy palette mapped to Editorial Forge semantics:
 *   cyan    → ember accent
 *   magenta → accent support (molten)
 *   yellow  → warning (brass)
 *   green   → success (oxidized)
 *   red     → danger (kiln)
 *   muted   → meta
 *
 * @module components/ui/Badge
 */

import type { ReactNode } from "react";

export interface BadgeProps {
  children: ReactNode;
  color?: "cyan" | "magenta" | "yellow" | "green" | "red" | "muted";
  className?: string;
}

const COLOR_MAP = {
  cyan: "border-accent/40 bg-accent/10 text-accent",
  magenta: "border-accent-support/40 bg-warning-soft text-accent-support",
  yellow: "border-warning/40 bg-warning-soft text-warning",
  green: "border-success/40 bg-success-soft text-success",
  red: "border-danger/40 bg-danger-soft text-danger",
  muted: "border-strong-edge bg-elevated text-meta",
} as const;

export function Badge({ children, color = "cyan", className = "" }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center rounded-sm border px-2 py-0.5
        font-mono text-[10px] font-semibold uppercase tracking-[0.1em]
        ${COLOR_MAP[color]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}
