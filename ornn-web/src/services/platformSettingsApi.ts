/**
 * Client for platform settings — admin-only config like the audit
 * waiver threshold and the LLM provider override.
 *
 * @module services/platformSettingsApi
 */

import { apiGet, apiPatch } from "./apiClient";

export interface LlmProviderConfig {
  /** Empty string ⇒ env default (Chrono LLM via NyxID gateway). */
  gatewayUrl: string;
  /**
   * Empty ⇒ NyxID SA token-exchange flow. Non-empty ⇒ direct Bearer.
   * The GET response masks the value to "••••••••" when set; echo
   * that mask back on PATCH to preserve the existing value.
   */
  apiKey: string;
}

export interface PlatformSettings {
  auditWaiverThreshold: number;
  llmProvider: LlmProviderConfig;
}

const DEFAULT_SETTINGS: PlatformSettings = {
  auditWaiverThreshold: 6.0,
  llmProvider: { gatewayUrl: "", apiKey: "" },
};

export async function fetchPlatformSettings(): Promise<PlatformSettings> {
  const res = await apiGet<PlatformSettings>("/api/v1/admin/settings");
  return res.data ?? DEFAULT_SETTINGS;
}

export async function updatePlatformSettings(
  patch: Partial<PlatformSettings>,
): Promise<PlatformSettings> {
  const res = await apiPatch<PlatformSettings>("/api/v1/admin/settings", patch);
  return res.data!;
}
