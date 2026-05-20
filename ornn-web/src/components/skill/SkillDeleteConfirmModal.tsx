/**
 * Delete-confirmation modal extracted from SkillDetailPage (#453).
 *
 * Confirms the user intends to delete the whole skill (not just a
 * version — version deletion is inside the All-versions browser).
 *
 * @module components/skill/SkillDeleteConfirmModal
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export interface SkillDeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  skillName: string;
  onConfirm: () => void;
  deleting: boolean;
}

export function SkillDeleteConfirmModal({
  isOpen,
  onClose,
  skillName,
  onConfirm,
  deleting,
}: SkillDeleteConfirmModalProps) {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("skillDetail.deleteTitle")}>
      <p className="font-text text-sm text-meta">
        {t("skillDetail.deleteConfirm", { name: skillName }).replace(/<\/?strong>/g, "")}
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm} loading={deleting}>
          {t("common.delete")}
        </Button>
      </div>
    </Modal>
  );
}
