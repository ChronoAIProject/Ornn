/**
 * ThinkingBubble — pre-token streaming indicator (#453).
 *
 * The pure helpers that used to live here (`extractEnvVarKeys`,
 * `isRuntimeBased`, `defaultPromptStarters`, plus the `TFunc` /
 * `PromptStarter` types) moved to the sibling
 * `PlaygroundHelpers.helpers.ts` so this file only exports components —
 * required for react-refresh / Fast Refresh (#888).
 *
 * @module components/playground/PlaygroundHelpers
 */

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

/** Pre-token streaming indicator — three pulsing ember dots, spring-in. */
export function ThinkingBubble() {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 320, damping: 28, mass: 0.6 }}
      className="flex justify-start"
    >
      <div className="rounded-2xl border border-subtle bg-card px-4 py-3">
        <div className="flex items-center gap-1.5" aria-label={t("aria.generating")}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "0ms" }} />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "150ms" }} />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </motion.div>
  );
}
