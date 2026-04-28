/**
 * Button — Editorial Forge primitive.
 *
 * Three variants per DESIGN.md:
 *   primary    — ember fill, page-bg text, mono uppercase label
 *   secondary  — outline, strong border, body text
 *   danger     — outline, danger color, kiln-red on hover
 *
 * @module components/ui/Button
 */

import { motion } from "framer-motion";
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
    "bg-accent text-page hover:bg-accent-muted border border-accent",
  secondary:
    "bg-transparent text-strong border border-strong-edge hover:bg-elevated hover:border-strong",
  danger:
    "bg-transparent text-danger border border-danger/40 hover:bg-danger-soft hover:border-danger",
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

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      whileTap={isDisabled ? undefined : { y: 0 }}
      whileHover={isDisabled ? undefined : { y: -1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className={`
        cursor-pointer rounded-sm font-mono font-semibold uppercase
        transition-colors duration-150
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
        ${VARIANT_STYLES[variant]}
        ${SIZE_STYLES[size]}
        ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}
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
    </motion.button>
  );
}
