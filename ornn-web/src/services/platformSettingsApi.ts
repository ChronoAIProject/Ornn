/**
 * Client for platform settings — admin-only config like the audit
 * waiver threshold.
 *
 * @module services/platformSettingsApi
 */

import { apiGet, apiPatch } from "./apiClient";

export interface PlatformSettings {
  auditWaiverThreshold: number;
}

export async function fetchPlatformSettings(): Promise<PlatformSettings> {
  const res = await apiGet<PlatformSettings>("/api/v1/admin/settings");
  return res.data ?? { auditWaiverThreshold: 6.0 };
}

export async function updatePlatformSettings(
  patch: Partial<PlatformSettings>,
): Promise<PlatformSettings> {
  const res = await apiPatch<PlatformSettings>("/api/v1/admin/settings", patch);
  return res.data!;
}
