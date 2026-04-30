/**
 * Admin Tags Page.
 * Tag management for administrators.
 * @module pages/admin/TagsPage
 */

import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { TagManager } from "@/components/admin/TagManager";
import { useTags, useCreateTag, useDeleteTag } from "@/hooks/useAdmin";
import { useToastStore } from "@/stores/toastStore";

export function TagsPage() {
  const { addToast } = useToastStore();

  const { data: tags, isLoading, error } = useTags();
  const createMutation = useCreateTag();
  const deleteMutation = useDeleteTag();

  const handleCreate = async (name: string) => {
    try {
      await createMutation.mutateAsync(name);
      addToast({ type: "success", message: "Tag created" });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to create tag",
      });
      throw err;
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      addToast({ type: "success", message: "Tag deleted" });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to delete tag",
      });
      throw err;
    }
  };

  const isActionLoading = createMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-accent-support accent-support">
          Tags
        </h1>
        <p className="mt-1 font-text text-meta">
          Manage predefined tags for skill categorization
        </p>
      </div>

      {/* Info Card */}
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10">
            <svg
              className="h-5 w-5 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
          </div>
          <div>
            <h3 className="font-display text-sm font-medium text-strong">
              Tag System
            </h3>
            <p className="mt-1 font-text text-sm text-meta">
              Tags help users find and organize skills. The platform uses a hybrid system:
            </p>
            <ul className="mt-2 space-y-1 font-text text-sm text-meta">
              <li>
                <span className="text-accent">Predefined tags</span> - Created by admins,
                suggested to users
              </li>
              <li>
                <span className="text-accent">Custom tags</span> - Created by users when
                uploading skills (max 30 chars)
              </li>
            </ul>
            <p className="mt-2 font-text text-xs text-meta">
              Each skill can have up to 10 tags.
            </p>
          </div>
        </div>
      </Card>

      {/* Tags Manager */}
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
              <p className="font-text text-danger">
                {error instanceof Error ? error.message : "Failed to load tags"}
              </p>
            </div>
          ) : (
            <TagManager
              tags={tags ?? []}
              onCreate={handleCreate}
              onDelete={handleDelete}
              loading={isActionLoading}
            />
          )}
        </Card>
      </motion.div>
    </div>
  );
}
