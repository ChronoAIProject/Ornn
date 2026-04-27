/**
 * My Skills Page - displays user's own skills with management controls.
 * Supports search and pagination.
 * @module pages/MySkillsPage
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
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
  const { t } = useTranslation();
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
      addToast({ type: "success", message: t("mySkills.deleteSuccess") });
    } catch {
      addToast({ type: "error", message: t("mySkills.deleteFailed") });
    } finally {
      setSkillToDelete(null);
    }
  };

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2">
      {/* Search bar */}
      <div className="mb-3 shrink-0">
        <Input
          placeholder={t("mySkills.searchPlaceholder")}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          className="w-full"
        />
      </div>

      {/* Skills count */}
      {data && !isLoading && (
        <div className="mb-2 shrink-0">
          <p className="font-body text-xs text-text-muted">
            {t("mySkills.skillsFound", { count: data.total, unit: data.total === 1 ? t("common.skill") : t("common.skills") })}
          </p>
        </div>
      )}

      {/* Scrollable skills grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1 -mx-2 -my-1">
        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : data?.items.length === 0 ? (
          <EmptyState
            title={debouncedSearch ? t("mySkills.noMatching") : t("mySkills.noSkillsYet")}
            description={
              debouncedSearch
                ? t("mySkills.tryAdjusting")
                : t("mySkills.createFirst")
            }
            action={
              !debouncedSearch ? (
                <Button onClick={() => navigate("/skills/new")}>{t("explore.createSkill")}</Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearchInput("");
                  }}
                >
                  {t("common.clearSearch")}
                </Button>
              )
            }
          />
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pb-4"
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

        {totalPages > 1 && (
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        )}
      </div>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!skillToDelete}
        onClose={() => setSkillToDelete(null)}
        title={t("mySkills.deleteTitle")}
      >
        <div className="space-y-4">
          <p className="font-body text-text-primary">
            {t("mySkills.deleteConfirm", { name: skillToDelete?.name }).replace(/<\/?strong>/g, "")}
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSkillToDelete(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteConfirm}
              loading={deleteMutation.isPending}
            >
              {t("common.delete")}
            </Button>
          </div>
        </div>
      </Modal>
      </div>
    </PageTransition>
  );
}
