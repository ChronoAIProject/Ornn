/**
 * Tag Manager Component.
 * Create and delete predefined tags.
 * @module components/admin/TagManager
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import type { Tag } from "@/types/admin";

export interface TagManagerProps {
  /** Tags list. */
  tags: Tag[];
  /** Called when a tag is created. */
  onCreate: (name: string) => Promise<void>;
  /** Called when a tag is deleted. */
  onDelete: (id: string) => Promise<void>;
  /** Loading state. */
  loading?: boolean;
}

export function TagManager({
  tags,
  onCreate,
  onDelete,
  loading = false,
}: TagManagerProps) {
  const [newTagName, setNewTagName] = useState("");
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Sort tags: predefined first, then by usage count
  const sortedTags = [...tags].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "predefined" ? -1 : 1;
    }
    return b.usageCount - a.usageCount;
  });

  const predefinedTags = sortedTags.filter((t) => t.type === "predefined");
  const customTags = sortedTags.filter((t) => t.type === "custom");

  const handleCreate = async () => {
    const name = newTagName.trim().toLowerCase();

    if (!name) {
      setError("Tag name is required");
      return;
    }

    if (name.length > 30) {
      setError("Tag name must be 30 characters or less");
      return;
    }

    if (!/^[a-z0-9-_]+$/.test(name)) {
      setError("Only lowercase letters, numbers, hyphens, and underscores allowed");
      return;
    }

    if (tags.some((t) => t.name === name)) {
      setError("Tag already exists");
      return;
    }

    try {
      await onCreate(name);
      setNewTagName("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tag");
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      await onDelete(deleteId);
      setDeleteId(null);
    }
  };

  const tagToDelete = tags.find((t) => t.id === deleteId);

  return (
    <div className="space-y-6">
      {/* Create Tag */}
      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            placeholder="Enter tag name (e.g., python, react, api)"
            value={newTagName}
            onChange={(e) => {
              setNewTagName(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            error={error}
          />
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={handleCreate}
          loading={loading}
          disabled={loading || !newTagName.trim()}
        >
          Add Tag
        </Button>
      </div>

      {/* Predefined Tags */}
      <div>
        <h3 className="mb-3 font-heading text-sm uppercase tracking-wider text-neon-cyan">
          Predefined Tags ({predefinedTags.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          <AnimatePresence mode="popLayout">
            {predefinedTags.map((tag) => (
              <motion.div
                key={tag.id}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.2 }}
                className="group relative"
              >
                <span className="inline-flex items-center gap-2 rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-3 py-1.5 font-body text-sm text-neon-cyan">
                  {tag.name}
                  <span className="text-xs text-neon-cyan/60">
                    ({tag.usageCount})
                  </span>
                  <button
                    onClick={() => setDeleteId(tag.id)}
                    className="ml-1 rounded-full p-0.5 text-neon-cyan/50 hover:bg-neon-red/20 hover:text-neon-red transition-colors"
                    disabled={loading}
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {predefinedTags.length === 0 && (
            <p className="font-body text-sm text-text-muted">
              No predefined tags yet. Add some to help users categorize skills.
            </p>
          )}
        </div>
      </div>

      {/* Custom Tags (Read-only info) */}
      {customTags.length > 0 && (
        <div>
          <h3 className="mb-3 font-heading text-sm uppercase tracking-wider text-text-muted">
            User-Created Tags ({customTags.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {customTags.slice(0, 30).map((tag) => (
              <Badge key={tag.id} color="muted">
                {tag.name} ({tag.usageCount})
              </Badge>
            ))}
            {customTags.length > 30 && (
              <Badge color="muted">+{customTags.length - 30} more</Badge>
            )}
          </div>
          <p className="mt-2 font-body text-xs text-text-muted">
            These tags were created by users and cannot be edited from here.
          </p>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete Tag?"
      >
        <div className="space-y-4">
          <p className="font-body text-text-primary">
            Are you sure you want to delete the tag{" "}
            <span className="font-semibold text-neon-cyan">
              {tagToDelete?.name}
            </span>
            ?
          </p>
          {tagToDelete && tagToDelete.usageCount > 0 && (
            <div className="rounded-lg border border-neon-yellow/30 bg-neon-yellow/10 p-3">
              <p className="font-body text-sm text-neon-yellow">
                This tag is currently used by {tagToDelete.usageCount} skill(s).
                Deleting it will remove it from all associated skills.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDeleteId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              loading={loading}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
