/**
 * Picker-side model hooks (post #270 — admin model-catalog hooks moved
 * into the per-provider `LlmProvidersSection` flow). What's here:
 *
 *   - `usePickerModels(surface)` — `GET /api/v1/me/models?surface=...`
 *     wrapped in TanStack Query.
 *   - `usePreferredModel(surface)` — `[modelId, setModelId]` backed by
 *     `localStorage` so the user's last choice survives reloads, with a
 *     stale-value fallback to the admin-set surface default when the
 *     stored choice is no longer enabled. The picker on playground /
 *     skill-gen consumes this directly.
 *
 * @module hooks/useModels
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchPickerModels, type PickerResult } from "@/services/modelsApi";
import type { Surface } from "@/services/quotaApi";
import { useIsAuthenticated } from "@/stores/authStore";

const STORAGE_KEY: Record<Surface, string> = {
  playground: "ornn.preferredModel.playground",
  skillGen: "ornn.preferredModel.skillGen",
};

export const PICKER_MODELS_KEY = (surface: Surface) =>
  ["me", "models", surface] as const;

export function usePickerModels(
  surface: Surface,
  enabled = true,
): UseQueryResult<PickerResult> {
  const isAuthed = useIsAuthenticated();
  return useQuery({
    queryKey: PICKER_MODELS_KEY(surface),
    queryFn: () => fetchPickerModels(surface),
    enabled: enabled && isAuthed,
    staleTime: 5 * 60_000,
  });
}

/**
 * Read+write the user's preferred model for a given surface. The stored
 * value is the modelId. When the stored model is no longer enabled (e.g.
 * admin disabled it after the user last picked), `effectiveModelId`
 * silently falls back to the admin default while leaving the stored
 * value alone — so if the model gets re-enabled, the user's preference
 * is restored.
 */
export function usePreferredModel(surface: Surface): {
  effectiveModelId: string | null;
  storedModelId: string | null;
  setPreferred: (modelId: string) => void;
  options: PickerResult["items"];
  defaultModelId: string | null;
  isLoading: boolean;
  isEmpty: boolean;
} {
  const { data, isLoading } = usePickerModels(surface);

  const [storedModelId, setStoredModelId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(STORAGE_KEY[surface]);
    } catch {
      return null;
    }
  });

  // Sync state if the user clears storage in another tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY[surface]) {
        setStoredModelId(e.newValue);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [surface]);

  const setPreferred = useCallback(
    (modelId: string) => {
      setStoredModelId(modelId);
      try {
        window.localStorage.setItem(STORAGE_KEY[surface], modelId);
      } catch {
        /* storage may be unavailable in private mode — ignore */
      }
    },
    [surface],
  );

  const options = data?.items ?? [];
  const defaultModelId = data?.defaultModelId ?? null;

  const effectiveModelId = useMemo(() => {
    if (!data) return storedModelId ?? null;
    if (
      storedModelId &&
      data.items.some((m) => m.modelId === storedModelId)
    ) {
      return storedModelId;
    }
    return defaultModelId;
  }, [data, defaultModelId, storedModelId]);

  return {
    effectiveModelId,
    storedModelId,
    setPreferred,
    options,
    defaultModelId,
    isLoading,
    isEmpty: !isLoading && (data?.items.length ?? 0) === 0,
  };
}
