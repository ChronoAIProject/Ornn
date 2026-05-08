/**
 * Announcement API client — both the public popup endpoint and the
 * admin CRUD endpoints.
 *
 * @module services/announcementsApi
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "./apiClient";

export interface PublicAnnouncement {
  id: string;
  title: string;
  bodyMarkdown: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

export interface AdminAnnouncement {
  id: string;
  title: string;
  bodyMarkdown: string;
  ctaLabel: string | null;
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
  title: string;
  bodyMarkdown: string;
  ctaLabel?: string | null;
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
