/**
 * Caller-scoped notification endpoints — /api/v1/notifications/*.
 *
 * @module services/notificationsApi
 */

import { apiGet, apiPost } from "./apiClient";
import type { Notification } from "@/types/notifications";

export interface ListNotificationsOptions {
  /** When true, restrict to unread entries. Default false (all). */
  unread?: boolean;
  /** 1–200; backend clamps. Default 50. */
  limit?: number;
}

export async function fetchNotifications(
  opts: ListNotificationsOptions = {},
): Promise<Notification[]> {
  const params: Record<string, string | number | boolean | undefined> = {};
  if (opts.unread) params.unread = "true";
  if (opts.limit !== undefined) params.limit = opts.limit;
  const res = await apiGet<{ items: Notification[] }>("/api/v1/notifications", params);
  return res.data?.items ?? [];
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await apiGet<{ count: number }>("/api/v1/notifications/unread-count");
  return res.data?.count ?? 0;
}

export async function markNotificationRead(id: string): Promise<Notification | null> {
  const res = await apiPost<Notification>(`/api/v1/notifications/${id}/read`, {});
  return res.data ?? null;
}

export async function markAllNotificationsRead(): Promise<number> {
  const res = await apiPost<{ updated: number }>("/api/v1/notifications/mark-all-read", {});
  return res.data?.updated ?? 0;
}
