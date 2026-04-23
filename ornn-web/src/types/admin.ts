/**
 * Admin-related type definitions.
 * Simplified: user management moved to NyxID.
 * @module types/admin
 */

/**
 * Category definition.
 */
export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  order: number;
  skillCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for creating/updating a category.
 */
export interface CategoryInput {
  name: string;
  slug?: string;
  description: string;
  order?: number;
}

/**
 * Tag definition.
 */
export interface Tag {
  id: string;
  name: string;
  type: "predefined" | "custom";
  usageCount: number;
  createdAt: string;
}
