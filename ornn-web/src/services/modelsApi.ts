/**
 * Models catalog HTTP client — wraps `/api/v1/me/models` (picker) and the
 * `/api/v1/admin/models/*` catalog endpoints.
 *
 * Mirrors the backend types in `ornn-api/src/domains/models/types.ts`.
 *
 * @module services/modelsApi
 */

import { apiGet, apiPatch, apiPost } from "./apiClient";
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
    throw new Error("Picker models response missing");
  }
  return res.data;
}

export interface AdminModelRow {
  modelId: string;
  displayName: string;
  enabledForPlayground: boolean;
  enabledForSkillGen: boolean;
  defaultForPlayground: boolean;
  defaultForSkillGen: boolean;
  archived: boolean;
  lastSyncedAt: string;
  createdAt: string;
}

export interface AdminModelsList {
  items: AdminModelRow[];
  total: number;
}

export async function fetchAdminModels(includeArchived: boolean): Promise<AdminModelsList> {
  const res = await apiGet<AdminModelsList>("/api/v1/admin/models", {
    includeArchived: includeArchived ? "true" : "false",
  });
  if (!res.data) {
    throw new Error("Admin model catalog missing");
  }
  return res.data;
}

export interface RefreshOutcome {
  added: number;
  updated: number;
  archived: number;
  total: number;
  syncedAt: string;
}

export async function refreshModelCatalog(): Promise<RefreshOutcome> {
  const res = await apiPost<RefreshOutcome>("/api/v1/admin/models/refresh", {});
  if (!res.data) {
    throw new Error("Refresh response missing");
  }
  return res.data;
}

export interface PatchFlagsInput {
  enabledForPlayground?: boolean;
  enabledForSkillGen?: boolean;
  defaultForPlayground?: boolean;
  defaultForSkillGen?: boolean;
}

export async function patchModelFlags(
  modelId: string,
  patch: PatchFlagsInput,
): Promise<AdminModelRow> {
  const res = await apiPatch<AdminModelRow>(
    `/api/v1/admin/models/${encodeURIComponent(modelId)}`,
    patch,
  );
  if (!res.data) {
    throw new Error("Patch model response missing");
  }
  return res.data;
}
