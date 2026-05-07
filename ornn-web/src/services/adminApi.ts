/**
 * Admin API client (tags-only after #292; categories CRUD dropped).
 * @module services/adminApi
 */

import { apiGet, apiPost, apiDelete } from "./apiClient";
import type { Tag } from "@/types/admin";

// ============================================================================
// Tags
// ============================================================================

/**
 * Fetch all predefined tags.
 */
export async function getTags(): Promise<Tag[]> {
  const res = await apiGet<Tag[]>("/api/v1/admin/tags");
  return res.data ?? [];
}

/**
 * Create a predefined tag.
 */
export async function createTag(name: string): Promise<Tag> {
  const res = await apiPost<Tag>("/api/v1/admin/tags", { name });
  if (!res.data) {
    throw new Error("Failed to create tag");
  }
  return res.data;
}

/**
 * Delete a predefined tag.
 */
export async function deleteTag(id: string): Promise<void> {
  await apiDelete(`/api/v1/admin/tags/${id}`);
}
