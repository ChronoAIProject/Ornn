/**
 * Button — Forge Workshop primitive.
 *
 * Three variants per DESIGN.md:
 *   primary    — ember fill, page-bg text, mono uppercase label, ember letterpress
 *   secondary  — paper surface, strong border, ink letterpress
 *   danger     — paper surface, danger color, ink letterpress
 *
 * All variants carry a hard-offset letterpress impression at rest and
 * press DOWN on hover (translate +2px / +2px, shadow shrinks). Disabled
 * removes the impression entirely. Reduced-motion suppresses the
 * translate; the shadow swap alone communicates press.
 *
 * @module components/ui/Button
 */

import type { ReactNode } from "react";

export interface ButtonProps {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children: ReactNode;
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}

const VARIANT_STYLES = {
  primary:
    "bg-accent text-page hover:bg-accent-muted border border-accent-muted",
  secondary:
    "bg-card text-strong border border-strong-edge hover:border-accent",
  danger:
    "bg-card text-danger border border-danger/40 hover:border-danger",
} as const;

const SIZE_STYLES = {
  sm: "px-3 py-1.5 text-[11px] tracking-[0.1em]",
  md: "px-5 py-2.5 text-xs tracking-[0.12em]",
  lg: "px-6 py-3 text-sm tracking-[0.12em]",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  children,
  onClick,
  type = "button",
  disabled = false,
  className = "",
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const letterpressClass =
    variant === "primary"
      ? "cta-letterpress"
      : "cta-letterpress cta-letterpress--ghost";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`
        ${letterpressClass}
        cursor-pointer rounded-sm font-mono font-semibold uppercase
        ${VARIANT_STYLES[variant]}
        ${SIZE_STYLES[size]}
        ${isDisabled ? "cursor-not-allowed" : ""}
        ${className}
      `}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
          <span>Loading…</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
