/**
 * Announcement API client — both the public popup endpoint and the
 * admin CRUD endpoints.
 *
 * Content is **bilingual** (`*En` + `*Zh` per field). Public surfaces
 * receive both locales; consumers resolve at render time via
 * `pickLocalized()` in `lib/announcementLocale.ts`. EN is canonical /
 * required; ZH is optional and falls back to EN whenever empty.
 *
 * @module services/announcementsApi
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "./apiClient";

export interface PublicAnnouncement {
  id: string;
  titleEn: string;
  titleZh: string;
  bodyMarkdownEn: string;
  bodyMarkdownZh: string;
  ctaLabelEn: string | null;
  ctaLabelZh: string | null;
  ctaUrl: string | null;
}

/**
 * News-page list shape (#357). Extends `PublicAnnouncement` with an ISO
 * 8601 `publishedAt` so the page can render a locale-aware date eyebrow
 * above each entry. `publishedAt` is `startsAt ?? createdAt`.
 */
export interface PublicAnnouncementListItem extends PublicAnnouncement {
  publishedAt: string;
}

export interface AdminAnnouncement {
  id: string;
  titleEn: string;
  titleZh: string;
  bodyMarkdownEn: string;
  bodyMarkdownZh: string;
  ctaLabelEn: string | null;
  ctaLabelZh: string | null;
  ctaUrl: string | null;
  enabled: boolean;
  /** ISO 8601 string or null. */
  startsAt: string | null;
  /** ISO 8601 string or null. */
  endsAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementInput {
  titleEn: string;
  /** Optional — empty string ⇒ frontend will fall back to `titleEn`. */
  titleZh: string;
  bodyMarkdownEn: string;
  /** Optional — empty string ⇒ frontend will fall back to `bodyMarkdownEn`. */
  bodyMarkdownZh: string;
  ctaLabelEn?: string | null;
  /** Optional — null/empty ⇒ frontend will fall back to `ctaLabelEn`. */
  ctaLabelZh?: string | null;
  ctaUrl?: string | null;
  enabled: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

export type UpdateAnnouncementInput = Partial<CreateAnnouncementInput>;

/** Public — anonymous-friendly. Returns null when no record qualifies. */
export async function fetchActiveAnnouncement(): Promise<PublicAnnouncement | null> {
  const res = await apiGet<{ active: PublicAnnouncement | null }>(
    "/api/v1/announcements/active",
  );
  return res.data?.active ?? null;
}

/**
 * Public — anonymous-friendly. Returns every released announcement
 * (enabled + start gate elapsed), newest first. Powers the News page
 * archive at `/news` (#357).
 */
export async function fetchPublicAnnouncements(): Promise<PublicAnnouncementListItem[]> {
  const res = await apiGet<{ items: PublicAnnouncementListItem[] }>(
    "/api/v1/announcements",
  );
  return res.data?.items ?? [];
}

export async function fetchAdminAnnouncements(): Promise<AdminAnnouncement[]> {
  const res = await apiGet<{ items: AdminAnnouncement[] }>("/api/v1/admin/announcements");
  return res.data?.items ?? [];
}

export async function createAnnouncement(
  input: CreateAnnouncementInput,
): Promise<AdminAnnouncement> {
  const res = await apiPost<AdminAnnouncement>("/api/v1/admin/announcements", input);
  return res.data!;
}

export async function updateAnnouncement(
  id: string,
  patch: UpdateAnnouncementInput,
): Promise<AdminAnnouncement> {
  const res = await apiPatch<AdminAnnouncement>(
    `/api/v1/admin/announcements/${encodeURIComponent(id)}`,
    patch,
  );
  return res.data!;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await apiDelete(`/api/v1/admin/announcements/${encodeURIComponent(id)}`);
}
