/**
 * React Query hooks for the in-product notification center.
 *
 * Caller-gated: every hook is `enabled` only when the user is authenticated.
 * Anonymous callers short-circuit to empty data without firing a request.
 *
 * @module hooks/useNotifications
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type ListNotificationsOptions,
} from "@/services/notificationsApi";
import type { Notification } from "@/types/notifications";
import { useIsAuthenticated } from "@/stores/authStore";

const NOTIFICATIONS_KEY = ["notifications"] as const;
const UNREAD_COUNT_KEY = ["notifications", "unread-count"] as const;

/** 30s polling — cheap endpoint, UX feels live without WebSocket infra. */
const UNREAD_POLL_MS = 30_000;

export function useNotifications(opts: ListNotificationsOptions = {}) {
  const isAuthed = useIsAuthenticated();
  return useQuery<Notification[]>({
    queryKey: [...NOTIFICATIONS_KEY, opts] as const,
    queryFn: () => fetchNotifications(opts),
    enabled: isAuthed,
    staleTime: 10_000,
  });
}

export function useUnreadNotificationCount() {
  const isAuthed = useIsAuthenticated();
  return useQuery<number>({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: fetchUnreadCount,
    enabled: isAuthed,
    refetchInterval: isAuthed ? UNREAD_POLL_MS : false,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
    },
  });
}
