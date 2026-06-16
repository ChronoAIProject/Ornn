/**
 * SkillsetPermissionsModal — per-skillset access editor (#1125).
 *
 * Thin wrapper: the Modal shell + the skillset permissions mutation, around
 * the shared two-tab `PermissionsEditor`. Kept in lock-step with the skill
 * `PermissionsModal` (they now share the editor + selector). This also brings
 * skillsets the read/write level support they never had under the old
 * single-ladder UI.
 *
 * @module components/skillset/SkillsetPermissionsModal
 */

import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { useUpdateSkillsetPermissions } from "@/hooks/useSkillsets";
import { PermissionsEditor } from "@/components/permissions/PermissionsEditor";
import { initialGrantsForEditor, grantsSignature } from "@/components/permissions/initialGrants";
import type { SkillsetDetail } from "@/types/skillset";

interface SkillsetPermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  skillset: SkillsetDetail;
}

export function SkillsetPermissionsModal({ isOpen, onClose, skillset }: SkillsetPermissionsModalProps) {
  const { t } = useTranslation();
  const mutation = useUpdateSkillsetPermissions(skillset.guid, skillset.name);
  const grants = initialGrantsForEditor(skillset);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("permissions.title", "Permissions") as string}
      className="!max-w-2xl"
    >
      <PermissionsEditor
        key={`${isOpen ? "open" : "closed"}:${skillset.guid}:${skillset.isPrivate}:${grantsSignature(grants)}`}
        entityKind="skillset"
        initialIsPrivate={skillset.isPrivate}
        initialGrants={grants}
        saving={mutation.isPending}
        onSave={(isPrivate, nextGrants) =>
          mutation.mutateAsync({ isPrivate, grants: nextGrants }).then(() => undefined)
        }
        onCancel={onClose}
      />
    </Modal>
  );
}
