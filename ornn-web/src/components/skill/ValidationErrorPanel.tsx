/**
 * Validation Error Panel Component.
 * Displays frontmatter validation errors with field paths and messages.
 * Styled in the project's Forge Workshop design system.
 * Reusable across upload and generative modes.
 * @module components/skill/ValidationErrorPanel
 */

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { FrontmatterValidationError } from "@/utils/skillFrontmatterSchema";

export interface ValidationErrorPanelProps {
  /** Array of structured validation errors */
  errors: FrontmatterValidationError[];
  /** Optional title override (raw string — already translated by caller). */
  title?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Renders a bg-card panel with danger accent showing validation errors.
 * Each error displays the field path and a translated message looked up
 * from the entry's `messageKey` + `params`.
 */
export function ValidationErrorPanel({
  errors,
  title,
  className = "",
}: ValidationErrorPanelProps) {
  const { t } = useTranslation();
  if (errors.length === 0) return null;

  const resolvedTitle = title ?? t("errors.frontmatter.panelTitle");
  const countText = t("errors.frontmatter.panelCount", {
    count: errors.length,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`rounded border border-danger/30 bg-danger/5 p-4 ${className}`}
      role="alert"
      aria-live="polite"
    >
      {/* Left accent bar */}
      <div className="flex gap-3">
        <div className="w-1 shrink-0 rounded-full bg-danger/60" />

        <div className="flex-1 space-y-3">
          {/* Title */}
          <h3 className="font-display text-sm uppercase tracking-wider text-danger">
            {resolvedTitle}
          </h3>

          {/* Error count */}
          <p className="font-text text-xs text-meta">{countText}</p>

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
                  {t(err.messageKey, err.params ?? {})}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </motion.div>
  );
}
