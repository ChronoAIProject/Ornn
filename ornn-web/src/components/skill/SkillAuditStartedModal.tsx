/**
 * Audit-started modal extracted from SkillDetailPage (#453).
 *
 * Shown right after the user kicks off a manual audit — explains that
 * the run is now happening in the background and they can keep working
 * while it finishes. A new audit history row materializes when it lands.
 *
 * @module components/skill/SkillAuditStartedModal
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export interface SkillAuditStartedModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SkillAuditStartedModal({ isOpen, onClose }: SkillAuditStartedModalProps) {
  const { t } = useTranslation();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("skillDetail.auditStartedTitle", "Audit started") as string}
    >
      <p className="font-text text-sm text-meta">
        {t(
          "skillDetail.auditStartedBody",
          "We're running the audit in the background. It takes around 20-30 seconds — when it's done, a new entry will appear in the Audit history. You can close this dialog and keep working.",
        )}
      </p>
      <div className="mt-6 flex justify-end">
        <Button size="sm" onClick={onClose}>
          {t("common.gotIt", "Got it")}
        </Button>
      </div>
    </Modal>
  );
}
