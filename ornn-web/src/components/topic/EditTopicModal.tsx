import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useUpdateTopic } from "@/hooks/useTopics";
import { useToastStore } from "@/stores/toastStore";
import type { Topic } from "@/types/domain";

export interface EditTopicModalProps {
  isOpen: boolean;
  onClose: () => void;
  topic: Topic;
}

/**
 * Edit modal. Name is immutable by backend contract.
 */
export function EditTopicModal({ isOpen, onClose, topic }: EditTopicModalProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const updateMutation = useUpdateTopic(topic.guid);

  const [description, setDescription] = useState(topic.description);
  const [isPrivate, setIsPrivate] = useState(topic.isPrivate);

  useEffect(() => {
    setDescription(topic.description);
    setIsPrivate(topic.isPrivate);
  }, [topic.description, topic.isPrivate]);

  const handleClose = () => {
    if (updateMutation.isPending) return;
    onClose();
  };

  const handleSubmit = async () => {
    const patch: { description?: string; isPrivate?: boolean } = {};
    if (description.trim() !== topic.description.trim()) patch.description = description.trim();
    if (isPrivate !== topic.isPrivate) patch.isPrivate = isPrivate;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    try {
      await updateMutation.mutateAsync(patch);
      addToast({ type: "success", message: t("topic.updateSuccess") });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("topic.updateFailed");
      addToast({ type: "error", message });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t("topic.editTopic")}>
      <div className="space-y-4">
        <div>
          <label className="font-heading text-[11px] uppercase tracking-wider text-text-muted block mb-1.5">
            {t("topic.nameLabel")}
          </label>
          <p className="font-mono text-sm text-text-muted">{topic.name}</p>
          <p className="mt-1 font-body text-xs text-text-muted">{t("topic.nameImmutable")}</p>
        </div>

        <div>
          <label className="font-heading text-[11px] uppercase tracking-wider text-text-muted block mb-1.5">
            {t("topic.descriptionLabel")}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2048}
            rows={3}
            className="neon-input w-full rounded-lg px-3 py-2 font-body text-sm text-text-primary resize-y"
          />
        </div>

        <label className="flex items-center gap-3 cursor-pointer select-none glass rounded-lg p-3 border border-neon-cyan/10">
          <button
            type="button"
            role="switch"
            aria-checked={isPrivate}
            onClick={() => setIsPrivate((v) => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              isPrivate ? "bg-neon-cyan" : "bg-bg-elevated"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                isPrivate ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <div>
            <p className="font-body text-sm text-text-primary">{t("topic.private")}</p>
            <p className="font-body text-xs text-text-muted">{t("topic.privateHint")}</p>
          </div>
        </label>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={handleClose}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={handleSubmit} loading={updateMutation.isPending}>
          {t("common.save")}
        </Button>
      </div>
    </Modal>
  );
}
