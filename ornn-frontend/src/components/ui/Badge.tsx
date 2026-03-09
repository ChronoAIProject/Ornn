import type { ReactNode } from "react";

export interface BadgeProps {
  children: ReactNode;
  color?: "cyan" | "magenta" | "yellow" | "green" | "red" | "muted";
  className?: string;
}

const COLOR_MAP = {
  cyan: "bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30",
  magenta: "bg-neon-magenta/10 text-neon-magenta border-neon-magenta/30",
  yellow: "bg-neon-yellow/10 text-neon-yellow border-neon-yellow/30",
  green: "bg-neon-green/10 text-neon-green border-neon-green/30",
  red: "bg-neon-red/10 text-neon-red border-neon-red/30",
  muted: "bg-text-muted/10 text-text-muted border-text-muted/30",
} as const;

export function Badge({ children, color = "cyan", className = "" }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center rounded-full border px-2.5 py-0.5
        font-body text-xs font-semibold
        ${COLOR_MAP[color]}
        ${className}
      `}
    >
      {children}
    </span>
  );
}
