/**
 * React Query hooks for announcements.
 *
 *   - `useActiveAnnouncement` — public, anonymous-safe; landing-page popup.
 *   - `usePublicAnnouncements` — public, anonymous-safe; News page archive (#357).
 *   - `useAdminAnnouncements` — admin list (gated by AdminGuard).
 *   - `useCreate / useUpdate / useDelete` — admin mutations that
 *     invalidate the admin list, the public active query, AND the public
 *     list query so a just-saved announcement appears for visitors on
 *     both the popup and the News page immediately.
 *
 * @module hooks/useAnnouncements
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAnnouncement,
  deleteAnnouncement,
  fetchActiveAnnouncement,
  fetchAdminAnnouncements,
  fetchPublicAnnouncements,
  updateAnnouncement,
  type AdminAnnouncement,
  type CreateAnnouncementInput,
  type PublicAnnouncement,
  type PublicAnnouncementListItem,
  type UpdateAnnouncementInput,
} from "@/services/announcementsApi";

const ACTIVE_KEY = ["announcements", "active"] as const;
const PUBLIC_LIST_KEY = ["announcements", "public-list"] as const;
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

/**
 * Public-facing list for the News page (#357). Same caching window as
 * the popup query — content turns over slowly and admin mutations
 * invalidate explicitly via the shared invalidator.
 */
export function usePublicAnnouncements() {
  return useQuery<PublicAnnouncementListItem[]>({
    queryKey: PUBLIC_LIST_KEY,
    queryFn: fetchPublicAnnouncements,
    staleTime: 5 * 60_000,
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
    void qc.invalidateQueries({ queryKey: PUBLIC_LIST_KEY });
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
