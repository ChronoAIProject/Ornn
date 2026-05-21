/**
 * Small helpers + ThinkingBubble extracted from PlaygroundPage (#453).
 *
 * - `extractEnvVarKeys(metadata)` — pulls the unique `env.var` keys
 *   out of every runtime in a skill's metadata.
 * - `isRuntimeBased(metadata)` — true when the skill needs the
 *   sandbox (category "runtime-based" or "mixed"). Drives whether the
 *   Env drawer is offered + locks chat until vars are filled.
 * - `defaultPromptStarters(skillName, t)` — the three suggestion chips
 *   shown in the empty-state hero.
 * - `ThinkingBubble` — pre-token streaming indicator.
 *
 * @module components/playground/PlaygroundHelpers
 */

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

export type TFunc = ReturnType<typeof import("react-i18next").useTranslation>["t"];

export interface PromptStarter {
  label: string;
  body: string;
}

/** Extract env var keys from skill metadata. */
export function extractEnvVarKeys(metadata: Record<string, unknown> | null): string[] {
  if (!metadata) return [];
  const runtimes = metadata.runtimes as Array<{ envs?: Array<{ var: string }> }> | undefined;
  if (!runtimes?.length) return [];
  const keys: string[] = [];
  for (const rt of runtimes) {
    if (rt.envs) {
      for (const env of rt.envs) {
        if (env.var && !keys.includes(env.var)) {
          keys.push(env.var);
        }
      }
    }
  }
  return keys;
}

/** Check if skill is runtime-based. */
export function isRuntimeBased(metadata: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  const category = metadata.category as string;
  return category === "runtime-based" || category === "mixed";
}

/** Default suggestion chips on the empty-state hero. */
export function defaultPromptStarters(skillName: string, t: TFunc): PromptStarter[] {
  return [
    {
      label: t("playground.starter1Label", "Walk me through it"),
      body: t(
        "playground.starter1Body",
        "Walk me through what `{{name}}` does and the main ways I'd use it.",
        { name: skillName },
      ),
    },
    {
      label: t("playground.starter2Label", "Show an example"),
      body: t(
        "playground.starter2Body",
        "Give me a concrete usage example for `{{name}}` — make up sample input and run it.",
        { name: skillName },
      ),
    },
    {
      label: t("playground.starter3Label", "List capabilities"),
      body: t(
        "playground.starter3Body",
        "List every capability `{{name}}` exposes, with a one-line description for each.",
        { name: skillName },
      ),
    },
  ];
}

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
