/**
 * Admin hooks for managing admin operations.
 * User management and config hooks removed (handled by NyxID).
 * @module hooks/useAdmin
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as adminApi from "@/services/adminApi";
import type { CategoryInput } from "@/types/admin";

const ADMIN_KEY = "admin";

// ============================================================================
// Categories
// ============================================================================

/**
 * Hook to fetch categories.
 */
export function useCategories() {
  return useQuery({
    queryKey: [ADMIN_KEY, "categories"],
    queryFn: adminApi.getCategories,
  });
}

/**
 * Hook to create a category.
 */
export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CategoryInput) => adminApi.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_KEY, "categories"] });
    },
  });
}

/**
 * Hook to update a category.
 */
export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CategoryInput> }) =>
      adminApi.updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_KEY, "categories"] });
    },
  });
}

/**
 * Hook to delete a category.
 */
export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adminApi.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ADMIN_KEY, "categories"] });
    },
  });
}

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
