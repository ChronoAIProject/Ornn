/**
 * Validation Error Panel Component.
 * Displays frontmatter validation errors with field paths and messages.
 * Styled in the project's cyberpunk/neon design system.
 * Reusable across upload and generative modes.
 * @module components/skill/ValidationErrorPanel
 */

import { motion } from "framer-motion";
import type { FrontmatterValidationError } from "@/utils/skillFrontmatterSchema";

export interface ValidationErrorPanelProps {
  /** Array of structured validation errors */
  errors: FrontmatterValidationError[];
  /** Optional title override */
  title?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Renders a glass panel with danger accent showing validation errors.
 * Each error displays the field path and human-readable message.
 */
export function ValidationErrorPanel({
  errors,
  title = "Frontmatter Validation Errors",
  className = "",
}: ValidationErrorPanelProps) {
  if (errors.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`rounded-lg border border-danger/30 bg-danger/5 p-4 ${className}`}
      role="alert"
      aria-live="polite"
    >
      {/* Left accent bar */}
      <div className="flex gap-3">
        <div className="w-1 shrink-0 rounded-full bg-danger/60" />

        <div className="flex-1 space-y-3">
          {/* Title */}
          <h3 className="font-display text-sm uppercase tracking-wider text-danger">
            {title}
          </h3>

          {/* Error count */}
          <p className="font-text text-xs text-meta">
            {errors.length} {errors.length === 1 ? "error" : "errors"}{" "}
            found. Fix all errors before saving.
          </p>

          {/* Error list */}
          <ul className="space-y-2">
            {errors.map((err, idx) => (
              <li key={`${err.field}-${idx}`} className="flex gap-2">
                {/* Field path badge */}
                <span className="shrink-0 rounded border border-danger/20 bg-danger/10 px-1.5 py-0.5 font-mono text-xs text-danger">
                  {err.field || "root"}
                </span>
                {/* Error message */}
                <span className="font-text text-sm text-strong">
                  {err.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </motion.div>
  );
}
