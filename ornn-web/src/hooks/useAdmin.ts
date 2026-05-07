/**
 * Admin hooks (tags-only after #292; categories admin dropped).
 * @module hooks/useAdmin
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as adminApi from "@/services/adminApi";

const ADMIN_KEY = "admin";

// ============================================================================
// Tags
// ============================================================================

/**
 * Hook to fetch tags.
 */
export function useTags() {
  return useQuery({
    queryKey: [ADMIN_KEY, "tags"],
    queryFn: adminApi.getTags,
  });
}

/**
 * Hook to create a tag.
 */
export function useCreateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => adminApi.createTag(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_KEY, "tags"] });
    },
  });
}

/**
 * Hook to delete a tag.
 */
export function useDeleteTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adminApi.deleteTag(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_KEY, "tags"] });
    },
  });
}
