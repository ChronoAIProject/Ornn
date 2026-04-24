/**
 * React Query hooks for platform settings.
 *
 * @module hooks/usePlatformSettings
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPlatformSettings,
  updatePlatformSettings,
  type PlatformSettings,
} from "@/services/platformSettingsApi";

const PLATFORM_SETTINGS_KEY = ["platform-settings"] as const;

export function usePlatformSettings() {
  return useQuery<PlatformSettings>({
    queryKey: PLATFORM_SETTINGS_KEY,
    queryFn: fetchPlatformSettings,
    staleTime: 60_000,
  });
}

export function useUpdatePlatformSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PlatformSettings>) => updatePlatformSettings(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(PLATFORM_SETTINGS_KEY, updated);
    },
  });
}
