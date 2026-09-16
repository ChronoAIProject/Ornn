/**
 * Preferred generation mode for the generative skill builder (#1242).
 *
 * `localStorage`-backed like `usePreferredModel` so the toggle lands on
 * the user's last choice after a reload. The stored value is validated
 * against `GENERATION_MODES` — an unknown or missing value falls back to
 * `advanced`, which is also the server default, so a fresh browser and
 * an omitted field mean the same thing.
 *
 * @module hooks/useGenerationMode
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GENERATION_MODES, type GenerationMode } from "@/types/skillPackage";

export const GENERATION_MODE_STORAGE_KEY = "ornn.preferredMode.skillGen";

/** Matches the server's `DEFAULT_GENERATION_MODE`. */
export const DEFAULT_GENERATION_MODE: GenerationMode = "advanced";

function isGenerationMode(value: unknown): value is GenerationMode {
  return typeof value === "string" && (GENERATION_MODES as readonly string[]).includes(value);
}

function readStoredMode(): GenerationMode {
  if (typeof window === "undefined") return DEFAULT_GENERATION_MODE;
  try {
    const raw = window.localStorage.getItem(GENERATION_MODE_STORAGE_KEY);
    return isGenerationMode(raw) ? raw : DEFAULT_GENERATION_MODE;
  } catch {
    return DEFAULT_GENERATION_MODE;
  }
}

export function usePreferredGenerationMode(): [GenerationMode, (mode: GenerationMode) => void] {
  const [mode, setModeState] = useState<GenerationMode>(readStoredMode);

  // Sync if the user changes the preference in another tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key === GENERATION_MODE_STORAGE_KEY) {
        setModeState(isGenerationMode(e.newValue) ? e.newValue : DEFAULT_GENERATION_MODE);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setMode = useCallback((next: GenerationMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(GENERATION_MODE_STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable in private mode — ignore */
    }
  }, []);

  return [mode, setMode];
}

/**
 * Localized label + one-line description per mode. Shared by the
 * toggle (segment text, `title`, aria) and the composer hint row so the
 * copy cannot drift between the two.
 */
export function useGenerationModeCopy(): {
  labels: Record<GenerationMode, string>;
  hints: Record<GenerationMode, string>;
} {
  const { t } = useTranslation();
  return {
    labels: {
      simple: t("generative.modeSimple", "Simple"),
      advanced: t("generative.modeAdvanced", "Advanced"),
    },
    hints: {
      simple: t("generative.modeSimpleHint", "SKILL.md only — no scripts, references or assets"),
      advanced: t("generative.modeAdvancedHint", "SKILL.md plus scripts, references and assets"),
    },
  };
}
