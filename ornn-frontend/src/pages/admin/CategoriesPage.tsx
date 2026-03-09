/**
 * Admin Categories Page.
 * Category management for administrators.
 * @module pages/admin/CategoriesPage
 */

import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { CategoryManager } from "@/components/admin/CategoryManager";
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "@/hooks/useAdmin";
import { useToastStore } from "@/stores/toastStore";
import type { CategoryInput } from "@/types/admin";

export function CategoriesPage() {
  const { addToast } = useToastStore();

  const { data: categories, isLoading, error } = useCategories();
  const createMutation = useCreateCategory();
  const updateMutation = useUpdateCategory();
  const deleteMutation = useDeleteCategory();
  const handleCreate = async (data: CategoryInput) => {
    try {
      await createMutation.mutateAsync(data);
      addToast({ type: "success", message: "Category created" });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to create category",
      });
      throw err;
    }
  };

  const handleUpdate = async (id: string, data: Partial<CategoryInput>) => {
    try {
      await updateMutation.mutateAsync({ id, data });
      addToast({ type: "success", message: "Category updated" });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to update category",
      });
      throw err;
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      addToast({ type: "success", message: "Category deleted" });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to delete category",
      });
      throw err;
    }
  };

  const isActionLoading =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-neon-magenta neon-magenta">
          Categories
        </h1>
        <p className="mt-1 font-body text-text-muted">
          Manage skill categories based on execution requirements
        </p>
      </div>

      {/* Info Card */}
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neon-cyan/10">
            <svg
              className="h-5 w-5 text-neon-cyan"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <h3 className="font-heading text-sm font-medium text-text-primary">
              About Categories
            </h3>
            <p className="mt-1 font-body text-sm text-text-muted">
              Categories classify skills based on the client capabilities required to execute them:
            </p>
            <ul className="mt-2 space-y-1 font-body text-sm text-text-muted">
              <li>
                <span className="text-neon-cyan">plain</span> - No tools or runtime needed
              </li>
              <li>
                <span className="text-neon-cyan">tools_required</span> - Requires local tools
              </li>
              <li>
                <span className="text-neon-cyan">runtime_required</span> - Requires script runtime
              </li>
              <li>
                <span className="text-neon-cyan">mixed</span> - Requires both tools and runtime
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {/* Categories Manager */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          {isLoading ? (
            <Skeleton lines={6} />
          ) : error ? (
            <div className="py-8 text-center">
              <p className="font-body text-neon-red">
                {error instanceof Error ? error.message : "Failed to load categories"}
              </p>
            </div>
          ) : (
            <CategoryManager
              categories={categories ?? []}
              onCreate={handleCreate}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              loading={isActionLoading}
            />
          )}
        </Card>
      </motion.div>
    </div>
  );
}
