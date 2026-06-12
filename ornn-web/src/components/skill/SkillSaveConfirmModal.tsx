/**
 * Save-confirmation modal extracted from SkillDetailPage (#453).
 *
 * Confirms the user intends to save uncommitted changes back to the
 * skill package + offers the `skipValidation` opt-out for the trust
 * scanner. Stateless wrapper — the parent owns the toggle, the parent
 * triggers the save mutation, the parent passes loading state in.
 *
 * @module components/skill/SkillSaveConfirmModal
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export interface SkillSaveConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  skillName: string;
  skipValidation: boolean;
  onSkipValidationChange: (next: boolean) => void;
  onConfirm: () => void;
  saving: boolean;
}

export function SkillSaveConfirmModal({
  isOpen,
  onClose,
  skillName,
  skipValidation,
  onSkipValidationChange,
  onConfirm,
  saving,
}: SkillSaveConfirmModalProps) {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("skillDetail.saveChanges")}>
      <p className="mb-4 font-text text-sm text-meta">
        {t("skillDetail.saveConfirm", { name: skillName })}
      </p>
      <label className="flex cursor-pointer items-center gap-3 rounded-sm border border-subtle bg-elevated p-3 select-none">
        <button
          type="button"
          role="switch"
          aria-checked={skipValidation}
          onClick={() => onSkipValidationChange(!skipValidation)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            skipValidation ? "bg-accent" : "bg-elevated"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              skipValidation ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
        <div>
          <p className="font-text text-sm text-strong">{t("skillDetail.skipValidation")}</p>
          <p className="font-text text-xs text-meta">{t("skillDetail.skipDescription")}</p>
        </div>
      </label>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={onConfirm} loading={saving}>
          {t("common.save")}
        </Button>
      </div>
    </Modal>
  );
}
