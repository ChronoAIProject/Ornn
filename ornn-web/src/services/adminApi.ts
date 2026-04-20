/**
 * Admin API client.
 * Handles admin-related API calls for categories and tags.
 * User management and platform config removed (handled by NyxID).
 * @module services/adminApi
 */

import { apiGet, apiPost, apiPut, apiDelete } from "./apiClient";
import type {
  Category,
  CategoryInput,
  Tag,
} from "@/types/admin";

// ============================================================================
// Categories
// ============================================================================

/**
 * Fetch all categories.
 */
export async function getCategories(): Promise<Category[]> {
  const res = await apiGet<Category[]>("/api/admin/categories");
  return res.data ?? [];
}

/**
 * Create a new category.
 */
export async function createCategory(data: CategoryInput): Promise<Category> {
  const res = await apiPost<Category>("/api/admin/categories", data);
  if (!res.data) {
    throw new Error("Failed to create category");
  }
  return res.data;
}

/**
 * Update a category.
 */
export async function updateCategory(
  id: string,
  data: Partial<CategoryInput>
): Promise<Category> {
  const res = await apiPut<Category>(`/api/admin/categories/${id}`, data);
  if (!res.data) {
    throw new Error("Failed to update category");
  }
  return res.data;
}

/**
 * Delete a category.
 */
export async function deleteCategory(id: string): Promise<void> {
  await apiDelete(`/api/admin/categories/${id}`);
}

// ============================================================================
// Tags
// ============================================================================

/**
 * Fetch all predefined tags.
 */
export async function getTags(): Promise<Tag[]> {
  const res = await apiGet<Tag[]>("/api/admin/tags");
  return res.data ?? [];
}

/**
 * Create a predefined tag.
 */
export async function createTag(name: string): Promise<Tag> {
  const res = await apiPost<Tag>("/api/admin/tags", { name });
  if (!res.data) {
    throw new Error("Failed to create tag");
  }
  return res.data;
}

/**
 * Delete a predefined tag.
 */
export async function deleteTag(id: string): Promise<void> {
  await apiDelete(`/api/admin/tags/${id}`);
}
