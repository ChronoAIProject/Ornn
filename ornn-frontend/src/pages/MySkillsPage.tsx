/**
 * My Skills Page - displays user's own skills with management controls.
 * Supports search and pagination.
 * @module pages/MySkillsPage
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { SkillCard } from "@/components/skill/SkillCard";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useMySkills, useDeleteSkill } from "@/hooks/useSkills";
import { useCurrentUser } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { useDebounce } from "@/hooks/useDebounce";
import type { SkillSearchResult } from "@/types/search";

const DEFAULT_PAGE_SIZE = 20;

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

export function MySkillsPage() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const addToast = useToastStore((s) => s.addToast);

  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [skillToDelete, setSkillToDelete] = useState<SkillSearchResult | null>(null);

  const debouncedSearch = useDebounce(searchInput, 300);

  const deleteMutation = useDeleteSkill();

  const { data, isLoading } = useMySkills({
    query: debouncedSearch || undefined,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const totalPages = data?.totalPages ?? 0;

  const handleDeleteClick = (skill: SkillSearchResult) => {
    setSkillToDelete(skill);
  };

  const handleDeleteConfirm = async () => {
    if (!skillToDelete) return;
    try {
      await deleteMutation.mutateAsync(skillToDelete.guid);
      addToast({ type: "success", message: "Skill deleted successfully" });
    } catch {
      addToast({ type: "error", message: "Failed to delete skill" });
    } finally {
      setSkillToDelete(null);
    }
  };

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto py-4">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="neon-cyan mb-2 font-heading text-3xl font-bold tracking-wider text-neon-cyan sm:text-4xl">
            MY SKILLS
          </h1>
          <p className="font-body text-text-muted">
            Manage your skills collection - create, edit, and share
          </p>
        </div>
        <Button onClick={() => navigate("/skills/new")}>
          Create Skill
        </Button>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Input
              placeholder="Search your skills..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              className="w-full"
            />
          </div>
        </div>
      </Card>

      {/* Skills count */}
      {data && !isLoading && (
        <div className="mb-4 flex items-center justify-between">
          <p className="font-body text-sm text-text-muted">
            {data.total} {data.total === 1 ? "skill" : "skills"} found
          </p>
        </div>
      )}

      {/* Skills grid */}
      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : data?.items.length === 0 ? (
        <EmptyState
          title={debouncedSearch ? "No matching skills" : "No skills yet"}
          description={
            debouncedSearch
              ? "Try adjusting your search"
              : "Create your first skill to get started"
          }
          action={
            !debouncedSearch ? (
              <Button onClick={() => navigate("/skills/new")}>Create Skill</Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchInput("");
                }}
              >
                Clear Search
              </Button>
            )
          }
        />
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {data?.items.map((skill) => (
            <motion.div key={skill.guid} variants={itemVariants}>
              <SkillCard
                skill={skill}
                showOwnerControls
                currentUserId={user?.id}
                ownerDisplayName={user?.displayName}
                ownerAvatarUrl={user?.avatarUrl}
                onDelete={handleDeleteClick}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!skillToDelete}
        onClose={() => setSkillToDelete(null)}
        title="Delete Skill?"
      >
        <div className="space-y-4">
          <p className="font-body text-text-primary">
            Are you sure you want to delete{" "}
            <span className="text-neon-cyan font-semibold">{skillToDelete?.name}</span>?
            This action cannot be undone.
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSkillToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteConfirm}
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
      </div>
    </PageTransition>
  );
}
