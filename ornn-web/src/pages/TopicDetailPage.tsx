import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { SkillCard } from "@/components/skill/SkillCard";
import { EditTopicModal } from "@/components/topic/EditTopicModal";
import { AddSkillsModal } from "@/components/topic/AddSkillsModal";
import { useTopic, useDeleteTopic, useRemoveSkillFromTopic } from "@/hooks/useTopics";
import { useCurrentUser, useIsAuthenticated, isAdmin } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: "easeOut" as const } },
};

function formatDateSGT(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TopicDetailPage() {
  const { idOrName } = useParams<{ idOrName: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useCurrentUser();
  const isAuthenticated = useIsAuthenticated();
  const addToast = useToastStore((s) => s.addToast);

  const { data: topic, isLoading, error } = useTopic(idOrName);
  const deleteMutation = useDeleteTopic();
  const removeSkillMutation = useRemoveSkillFromTopic(idOrName ?? "");

  const [showEdit, setShowEdit] = useState(false);
  const [showAddSkills, setShowAddSkills] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [removingGuid, setRemovingGuid] = useState<string | null>(null);

  const isOwner = !!(isAuthenticated && user?.id && topic?.createdBy === user.id);
  const isAdminUser = isAdmin(user);
  const canManage = isOwner || isAdminUser;

  if (isLoading) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center h-full">
          <Skeleton lines={10} />
        </div>
      </PageTransition>
    );
  }

  if (error || !topic) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <h2 className="mb-2 font-heading text-2xl text-neon-red">{t("topic.notFound")}</h2>
            <p className="text-text-muted">{t("topic.notFoundDesc")}</p>
            <Button onClick={() => navigate("/registry?tab=topics")} className="mt-6">
              {t("topic.backToTopics")}
            </Button>
          </div>
        </div>
      </PageTransition>
    );
  }

  const handleDeleteConfirm = async () => {
    try {
      await deleteMutation.mutateAsync(topic.guid);
      addToast({ type: "success", message: t("topic.deleteSuccess") });
      navigate("/registry?tab=topics");
    } catch (err) {
      const message = err instanceof Error ? err.message : t("topic.deleteFailed");
      addToast({ type: "error", message });
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleRemoveSkill = async (skillGuid: string) => {
    setRemovingGuid(skillGuid);
    try {
      await removeSkillMutation.mutateAsync(skillGuid);
      addToast({ type: "success", message: t("topic.removeSkillSuccess") });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("topic.removeSkillFailed");
      addToast({ type: "error", message });
    } finally {
      setRemovingGuid(null);
    }
  };

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2">
        <div className="flex-1 min-h-0 grid gap-4 lg:grid-cols-[1fr_300px]">
          {/* Main — skills grid */}
          <Card className="flex flex-col min-h-0 overflow-hidden">
            <div className="mb-3 flex items-center justify-between shrink-0">
              <h3 className="font-heading text-sm uppercase tracking-wider text-neon-cyan">
                {t("topic.skills")} ({topic.skillCount})
              </h3>
              {canManage && (
                <Button size="sm" onClick={() => setShowAddSkills(true)}>
                  {t("topic.addSkills")}
                </Button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pb-4">
              {topic.skills.length === 0 ? (
                <p className="py-12 text-center font-body text-sm text-text-muted">
                  {t("topic.noSkills")}
                </p>
              ) : (
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="grid gap-4 sm:grid-cols-2"
                >
                  {topic.skills.map((skill) => (
                    <motion.div key={skill.guid} variants={itemVariants} className="relative">
                      <SkillCard skill={skill} />
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => handleRemoveSkill(skill.guid)}
                          disabled={removingGuid === skill.guid}
                          title={t("topic.removeSkill")}
                          className="
                            absolute top-2 right-2 z-10
                            h-7 w-7 rounded-full
                            glass border border-neon-red/30
                            text-neon-red hover:border-neon-red hover:bg-neon-red/10
                            flex items-center justify-center cursor-pointer
                            disabled:opacity-50 disabled:cursor-not-allowed
                            transition-colors
                          "
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </div>
          </Card>

          {/* Sidebar */}
          <div className="flex flex-col min-h-0 overflow-y-auto gap-4">
            <div className="glass rounded-xl p-5 space-y-5">
              <div>
                <h2 className="font-heading text-xl text-neon-cyan">{topic.name}</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge color={topic.isPrivate ? "cyan" : "green"}>
                    {topic.isPrivate ? t("common.private") : t("common.public")}
                  </Badge>
                </div>
              </div>

              {topic.description && (
                <div>
                  <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-1.5">
                    {t("topic.descriptionLabel")}
                  </p>
                  <p className="font-body text-sm text-text-primary leading-relaxed">
                    {topic.description}
                  </p>
                </div>
              )}

              <div>
                <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-1.5">
                  {t("skillDetail.author")}
                </p>
                <p className="font-body text-sm text-text-primary truncate">
                  {topic.createdByDisplayName || topic.createdByEmail || topic.createdBy}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-0.5">
                    {t("skillDetail.created")}
                  </p>
                  <p className="font-body text-xs text-text-primary">
                    {formatDateSGT(topic.createdOn)}
                  </p>
                </div>
                {topic.updatedOn && (
                  <div>
                    <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted mb-0.5">
                      {t("skillDetail.updated")}
                    </p>
                    <p className="font-body text-xs text-text-primary">
                      {formatDateSGT(topic.updatedOn)}
                    </p>
                  </div>
                )}
              </div>

              {canManage && (
                <>
                  <div className="border-t border-neon-cyan/10" />
                  <div className="space-y-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowEdit(true)}
                    >
                      {t("topic.editTopic")}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      {t("topic.deleteTopic")}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <EditTopicModal isOpen={showEdit} onClose={() => setShowEdit(false)} topic={topic} />
        <AddSkillsModal
          isOpen={showAddSkills}
          onClose={() => setShowAddSkills(false)}
          topicIdOrName={topic.guid}
          existingSkillGuids={topic.skills.map((s) => s.guid)}
        />

        <Modal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          title={t("topic.deleteTopic")}
        >
          <p className="font-body text-sm text-text-muted">
            {t("topic.deleteConfirm", { name: topic.name })}
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setShowDeleteConfirm(false)}>
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
        </Modal>
      </div>
    </PageTransition>
  );
}
