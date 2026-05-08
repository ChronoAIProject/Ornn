/**
 * React Query hooks for announcements.
 *
 *   - `useActiveAnnouncement` — public, anonymous-safe; landing-page popup.
 *   - `useAdminAnnouncements` — admin list (gated by AdminGuard).
 *   - `useCreate / useUpdate / useDelete` — admin mutations that
 *     invalidate both the admin list and the public active query so a
 *     just-saved announcement appears for visitors immediately.
 *
 * @module hooks/useAnnouncements
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchActiveAnnouncement,
  fetchAdminAnnouncements,
  updateAnnouncement,
  type AdminAnnouncement,
  type CreateAnnouncementInput,
  type PublicAnnouncement,
  type UpdateAnnouncementInput,
} from "@/services/announcementsApi";

const ACTIVE_KEY = ["announcements", "active"] as const;
const ADMIN_KEY = ["announcements", "admin"] as const;

export function useActiveAnnouncement(opts: { enabled?: boolean } = {}) {
  return useQuery<PublicAnnouncement | null>({
    queryKey: ACTIVE_KEY,
    queryFn: fetchActiveAnnouncement,
    // 5min — content rarely changes; admin mutations invalidate explicitly.
    staleTime: 5 * 60_000,
    enabled: opts.enabled ?? true,
  });
}

export function useAdminAnnouncements() {
  return useQuery<AdminAnnouncement[]>({
    queryKey: ADMIN_KEY,
    queryFn: fetchAdminAnnouncements,
    staleTime: 30_000,
  });
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ADMIN_KEY });
    void qc.invalidateQueries({ queryKey: ACTIVE_KEY });
  };
}

export function useCreateAnnouncement() {
  const invalidate = useInvalidateAll();
  return useMutation<AdminAnnouncement, Error, CreateAnnouncementInput>({
    mutationFn: createAnnouncement,
    onSuccess: invalidate,
  });
}

export function useUpdateAnnouncement() {
  const invalidate = useInvalidateAll();
  return useMutation<AdminAnnouncement, Error, { id: string; patch: UpdateAnnouncementInput }>({
    mutationFn: ({ id, patch }) => updateAnnouncement(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteAnnouncement() {
  const invalidate = useInvalidateAll();
  return useMutation<void, Error, string>({
    mutationFn: deleteAnnouncement,
    onSuccess: invalidate,
  });
}
