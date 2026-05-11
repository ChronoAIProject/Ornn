/**
 * Model picker HTTP client — wraps `GET /api/v1/me/models?surface=...`.
 *
 * Post #270 (per-provider model management) the admin catalog endpoints
 * are gone — flag toggling now happens via
 * `patchProviderModelFlags` in `services/settingsApi.ts`. The picker
 * route is the only thing that survives in this module, and it now
 * resolves across every provider's `models[]` instead of a global
 * standalone collection.
 *
 * @module services/modelsApi
 */

import { apiGet } from "./apiClient";
import type { Surface } from "./quotaApi";

export interface PickerModel {
  modelId: string;
  displayName: string;
  isDefault: boolean;
}

export interface PickerResult {
  items: PickerModel[];
  defaultModelId: string | null;
}

export async function fetchPickerModels(surface: Surface): Promise<PickerResult> {
  const res = await apiGet<PickerResult>("/api/v1/me/models", { surface });
  if (!res.data) {
    throw new Error("errors.api.models.pickerMissing");
  }
  return res.data;
}
