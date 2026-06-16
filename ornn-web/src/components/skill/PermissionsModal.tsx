/**
 * PermissionsModal — per-skill access editor (#1125).
 *
 * Thin wrapper: the Modal shell + the skill permissions mutation, around the
 * shared two-tab `PermissionsEditor` (Read / Write). Replaces the old
 * single-visibility-ladder UI so an owner can set independent read and write
 * audiences (e.g. public read + org write).
 *
 * @module components/skill/PermissionsModal
 */

import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { useUpdateSkillPermissions } from "@/hooks/useSkills";
import { PermissionsEditor } from "@/components/permissions/PermissionsEditor";
import { initialGrantsForEditor, grantsSignature } from "@/components/permissions/initialGrants";
import type { SkillDetail } from "@/types/domain";

interface PermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: SkillDetail;
}

export function PermissionsModal({ isOpen, onClose, skill }: PermissionsModalProps) {
  const { t } = useTranslation();
  const mutation = useUpdateSkillPermissions(skill.guid);
  const grants = initialGrantsForEditor(skill);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("permissions.title", "Permissions") as string}
      className="!max-w-2xl"
    >
      {/* Keyed on the ACL signature (+ open) so editor state resets by
          construction whenever the modal reopens or the grants change (#888). */}
      <PermissionsEditor
        key={`${isOpen ? "open" : "closed"}:${skill.guid}:${skill.isPrivate}:${grantsSignature(grants)}`}
        entityKind="skill"
        initialIsPrivate={skill.isPrivate}
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
