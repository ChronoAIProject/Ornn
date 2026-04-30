/**
 * Category Manager Component.
 * CRUD operations and drag-and-drop reordering for categories.
 * @module components/admin/CategoryManager
 */

import { useState } from "react";
import { motion, Reorder } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import type { Category, CategoryInput } from "@/types/admin";

export interface CategoryManagerProps {
  /** Categories list. */
  categories: Category[];
  /** Called when a category is created. */
  onCreate: (data: CategoryInput) => Promise<void>;
  /** Called when a category is updated. */
  onUpdate: (id: string, data: Partial<CategoryInput>) => Promise<void>;
  /** Called when a category is deleted. */
  onDelete: (id: string) => Promise<void>;
  /** Called when categories are reordered. */
  onReorder?: (orderedIds: string[]) => Promise<void>;
  /** Loading state. */
  loading?: boolean;
}

interface EditState {
  mode: "create" | "edit";
  category?: Category;
}

export function CategoryManager({
  categories,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  loading = false,
}: CategoryManagerProps) {
  const [items, setItems] = useState(categories);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CategoryInput>({
    name: "",
    slug: "",
    description: "",
  });
  const [formError, setFormError] = useState("");
  const [hasReordered, setHasReordered] = useState(false);

  // Sync items when categories change
  if (categories !== items && !hasReordered) {
    setItems(categories);
  }

  const handleReorder = (newOrder: Category[]) => {
    setItems(newOrder);
    setHasReordered(true);
  };

  const handleSaveOrder = async () => {
    const orderedIds = items.map((c) => c.id);
    await onReorder?.(orderedIds);
    setHasReordered(false);
  };

  const handleOpenCreate = () => {
    setFormData({ name: "", slug: "", description: "" });
    setFormError("");
    setEditState({ mode: "create" });
  };

  const handleOpenEdit = (category: Category) => {
    setFormData({
      name: category.name,
      slug: category.slug,
      description: category.description,
    });
    setFormError("");
    setEditState({ mode: "edit", category });
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setFormError("Name is required");
      return;
    }
    if (!formData.description.trim()) {
      setFormError("Description is required");
      return;
    }

    try {
      if (editState?.mode === "create") {
        await onCreate(formData);
      } else if (editState?.mode === "edit" && editState.category) {
        await onUpdate(editState.category.id, formData);
      }
      setEditState(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Operation failed");
    }
  };

  const handleDelete = async () => {
    if (deleteId) {
      await onDelete(deleteId);
      setDeleteId(null);
    }
  };

  const categoryToDelete = categories.find((c) => c.id === deleteId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="font-text text-sm text-meta">
          Drag to reorder. Categories determine skill classification.
        </p>
        <div className="flex gap-2">
          {hasReordered && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveOrder}
              loading={loading}
            >
              Save Order
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={handleOpenCreate}>
            Add Category
          </Button>
        </div>
      </div>

      {/* Category List */}
      <Reorder.Group
        axis="y"
        values={items}
        onReorder={handleReorder}
        className="space-y-2"
      >
        {items.map((category) => (
          <Reorder.Item
            key={category.id}
            value={category}
            className="cursor-grab active:cursor-grabbing"
          >
            <motion.div
              layout
              className="rounded border border-accent/20 bg-card p-4 hover:border-accent/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Drag Handle */}
                <div className="flex items-center gap-3">
                  <svg
                    className="h-5 w-5 text-meta"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 8h16M4 16h16"
                    />
                  </svg>

                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-display text-sm font-medium text-strong">
                        {category.name}
                      </h4>
                      <Badge color="muted">{category.slug}</Badge>
                    </div>
                    <p className="mt-1 font-text text-xs text-meta">
                      {category.description}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Badge color="cyan">{category.skillCount} skills</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleOpenEdit(category)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setDeleteId(category.id)}
                    disabled={category.skillCount > 0}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </motion.div>
          </Reorder.Item>
        ))}
      </Reorder.Group>

      {items.length === 0 && (
        <Card>
          <p className="py-8 text-center font-text text-meta">
            No categories yet. Create your first category to get started.
          </p>
        </Card>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={!!editState}
        onClose={() => setEditState(null)}
        title={editState?.mode === "create" ? "Create Category" : "Edit Category"}
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., plain, tools_required"
          />
          <Input
            label="Slug"
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
            placeholder="URL-friendly slug (auto-generated if empty)"
          />
          <Input
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Brief description of this category"
          />

          {formError && (
            <p className="font-text text-sm text-danger">{formError}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditState(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              loading={loading}
            >
              {editState?.mode === "create" ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete Category?"
      >
        <div className="space-y-4">
          <p className="font-text text-strong">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-accent">
              {categoryToDelete?.name}
            </span>
            ?
          </p>
          <p className="font-text text-sm text-meta">
            This action cannot be undone.
          </p>
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
