import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useCreateTopic } from "@/hooks/useTopics";
import { useToastStore } from "@/stores/toastStore";

const KEBAB_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export interface CreateTopicModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (topicName: string) => void;
}

export function CreateTopicModal({ isOpen, onClose, onCreated }: CreateTopicModalProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const createMutation = useCreateTopic();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setIsPrivate(false);
    setNameError(null);
  };

  const handleClose = () => {
    if (createMutation.isPending) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t("topic.nameRequired"));
      return;
    }
    if (!KEBAB_REGEX.test(trimmed)) {
      setNameError(t("topic.nameHelp"));
      return;
    }
    try {
      await createMutation.mutateAsync({
        name: trimmed,
        description: description.trim() || undefined,
        isPrivate,
      });
      addToast({ type: "success", message: t("topic.createSuccess") });
      onCreated?.(trimmed);
      reset();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("topic.createFailed");
      addToast({ type: "error", message });
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t("topic.createTopic")}>
      <div className="space-y-4">
        <div>
          <label className="font-heading text-[11px] uppercase tracking-wider text-text-muted block mb-1.5">
            {t("topic.nameLabel")}
          </label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            placeholder={t("topic.namePlaceholder")}
            maxLength={64}
          />
          <p className={`mt-1 font-body text-xs ${nameError ? "text-neon-red" : "text-text-muted"}`}>
            {nameError ?? t("topic.nameHelp")}
          </p>
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
        <Button size="sm" onClick={handleSubmit} loading={createMutation.isPending}>
          {t("topic.createTopic")}
        </Button>
      </div>
    </Modal>
  );
}
