/**
 * React Query hooks for admin broadcast CRUD.
 *
 * The admin list query (`useAdminBroadcasts`) is the only read path the
 * admin surface needs. User-facing reads ride through the existing
 * notifications hooks — broadcasts are merged server-side into the
 * `/notifications` feed — so mutations here invalidate BOTH the admin
 * list query AND the notification queries so a freshly authored
 * broadcast appears in every user's bell on the next refetch.
 *
 * @module hooks/useBroadcasts
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createBroadcast,
  deleteBroadcast,
  fetchAdminBroadcasts,
  updateBroadcast,
  type AdminBroadcast,
  type CreateBroadcastInput,
  type UpdateBroadcastInput,
} from "@/services/broadcastsApi";

const ADMIN_KEY = ["broadcasts", "admin"] as const;
const NOTIFICATIONS_KEY = ["notifications"] as const;
const UNREAD_COUNT_KEY = ["notifications", "unread-count"] as const;

export function useAdminBroadcasts() {
  return useQuery<AdminBroadcast[]>({
    queryKey: ADMIN_KEY,
    queryFn: fetchAdminBroadcasts,
    staleTime: 30_000,
  });
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ADMIN_KEY });
    // User-facing bell + unread badge — a fresh broadcast / edit / delete
    // must show up in the feed without a manual refetch.
    void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    void qc.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
  };
}

export function useCreateBroadcast() {
  const invalidate = useInvalidateAll();
  return useMutation<AdminBroadcast, Error, CreateBroadcastInput>({
    mutationFn: createBroadcast,
    onSuccess: invalidate,
  });
}

export function useUpdateBroadcast() {
  const invalidate = useInvalidateAll();
  return useMutation<
    AdminBroadcast,
    Error,
    { id: string; patch: UpdateBroadcastInput }
  >({
    mutationFn: ({ id, patch }) => updateBroadcast(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteBroadcast() {
  const invalidate = useInvalidateAll();
  return useMutation<void, Error, string>({
    mutationFn: deleteBroadcast,
    onSuccess: invalidate,
  });
}
