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
  primary: "border-neon-cyan/50 text-neon-cyan hover:border-neon-cyan hover:shadow-[0_0_15px_rgba(255,107,0,0.3)]",
  secondary: "border-neon-magenta/50 text-neon-magenta hover:border-neon-magenta hover:shadow-[0_0_15px_rgba(255,140,56,0.3)]",
  danger: "border-neon-red/50 text-neon-red hover:border-neon-red hover:shadow-[0_0_15px_rgba(255,0,60,0.3)]",
} as const;

const SIZE_STYLES = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-5 py-2.5 text-base",
  lg: "px-7 py-3 text-lg",
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
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      whileHover={isDisabled ? undefined : { scale: 1.02 }}
      transition={{ duration: 0.1, ease: "easeIn" }}
      className={`
        glass cursor-pointer rounded-lg font-body font-semibold
        transition-all duration-200
        ${VARIANT_STYLES[variant]}
        ${SIZE_STYLES[size]}
        ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}
        ${className}
      `}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Loading...
        </span>
      ) : (
        children
      )}
    </motion.button>
  );
}
