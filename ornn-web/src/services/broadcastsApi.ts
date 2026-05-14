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
 *
 * Note the field is `id`, NOT `_id`. The admin DTO and the
 * notification-feed DTO are deliberately different shapes even
 * though both project off the same `broadcasts` collection — the
 * feed keeps the `_id` legacy field for backwards compatibility
 * with per-user notification rows, while the admin surface gets
 * the cleaner public `id`.
 *
 * `recipientUserIds` is `null` for a broadcast-to-all and a
 * non-empty array for a targeted broadcast. Recipients are locked
 * at create — see `CreateBroadcastInput` / `UpdateBroadcastInput`.
 */
export interface AdminBroadcast {
  id: string;
  titleI18n: BilingualText;
  bodyMarkdownI18n: BilingualText;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  readCount: number;
  recipientUserIds: string[] | null;
}

export interface CreateBroadcastInput {
  titleI18n: BilingualText;
  bodyMarkdownI18n: BilingualText;
  /**
   * Optional list of user_ids to target. Omit / undefined → broadcast
   * to every authenticated user. A non-empty array scopes delivery to
   * exactly those users. An empty array is rejected by the API (400).
   */
  recipientUserIds?: string[];
}

/**
 * Patch input — both locales of a given field must arrive together if
 * any does (the drawer enforces non-empty on both anyway). Recipients
 * are deliberately omitted: the API rejects PATCH bodies that try to
 * change `recipientUserIds`, so we keep the field off the type to make
 * that impossible at compile time.
 */
export type UpdateBroadcastInput = Partial<
  Pick<CreateBroadcastInput, "titleI18n" | "bodyMarkdownI18n">
>;

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
