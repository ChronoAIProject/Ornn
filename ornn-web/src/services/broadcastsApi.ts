/**
 * Broadcast API client — admin CRUD over `/api/v1/admin/broadcasts/*`.
 *
 * Broadcasts are admin-authored bilingual messages (EN + ZH) that fan
 * out to every authenticated user's notification inbox. Both locales
 * are required at create time (no auto-fallback like announcements).
 *
 * The user-facing read path lives in `notificationsApi.ts` — backend
 * merges broadcasts into the existing `/notifications` feed with a
 * `source: "broadcast"` discriminator.
 *
 * @module services/broadcastsApi
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "./apiClient";

/** Bilingual text pair — both locales required on create. */
export interface BilingualText {
  en: string;
  zh: string;
}

/**
 * Admin row shape — includes `readCount` aggregated over the
 * `broadcast_read_receipts` collection plus mutation audit fields.
 */
export interface AdminBroadcast {
  _id: string;
  titleI18n: BilingualText;
  bodyMarkdownI18n: BilingualText;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  readCount: number;
}

export interface CreateBroadcastInput {
  titleI18n: BilingualText;
  bodyMarkdownI18n: BilingualText;
}

/**
 * Patch input — both locales of a given field must arrive together if
 * any does (the drawer enforces non-empty on both anyway). Modeled as
 * `Partial<CreateBroadcastInput>` so callers can omit untouched fields.
 */
export type UpdateBroadcastInput = Partial<CreateBroadcastInput>;

export async function fetchAdminBroadcasts(): Promise<AdminBroadcast[]> {
  const res = await apiGet<{ items: AdminBroadcast[] }>(
    "/api/v1/admin/broadcasts",
  );
  return res.data?.items ?? [];
}

export async function createBroadcast(
  input: CreateBroadcastInput,
): Promise<AdminBroadcast> {
  const res = await apiPost<AdminBroadcast>("/api/v1/admin/broadcasts", input);
  return res.data!;
}

export async function updateBroadcast(
  id: string,
  patch: UpdateBroadcastInput,
): Promise<AdminBroadcast> {
  const res = await apiPatch<AdminBroadcast>(
    `/api/v1/admin/broadcasts/${encodeURIComponent(id)}`,
    patch,
  );
  return res.data!;
}

export async function deleteBroadcast(id: string): Promise<void> {
  await apiDelete(`/api/v1/admin/broadcasts/${encodeURIComponent(id)}`);
}
