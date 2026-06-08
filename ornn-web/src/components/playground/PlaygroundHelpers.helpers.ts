/**
 * Pure helpers extracted from PlaygroundHelpers.tsx so that file only
 * exports components — required for react-refresh / Fast Refresh (#888).
 *
 * - `extractEnvVarKeys(metadata)` — pulls the unique `env.var` keys out
 *   of every runtime in a skill's metadata.
 * - `isRuntimeBased(metadata)` — true when the skill needs the sandbox
 *   (category "runtime-based" or "mixed").
 * - `defaultPromptStarters(skillName, t)` — the three suggestion chips
 *   shown in the empty-state hero.
 *
 * @module components/playground/PlaygroundHelpers.helpers
 */

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
