/**
 * Admin-related type definitions.
 * Simplified: user management moved to NyxID.
 * @module types/admin
 */

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
