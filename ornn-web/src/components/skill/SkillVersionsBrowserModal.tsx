/**
 * All-versions browser modal extracted from SkillDetailPage (#453).
 *
 * Lists every version of a skill in a scrollable list, lets the user
 * jump to a different version (or back to "latest" by passing null
 * for the latest version id), and offers a "Compare versions" button
 * that opens the diff modal. Owners + admins can also deprecate /
 * undeprecate / delete individual versions inline via the embedded
 * `SkillVersionList`.
 *
 * The version-delete handler stays inline here because it shows a
 * success/failure toast — the parent doesn't need to own that flow,
 * so wrapping it lets the modal swallow the per-row interaction.
 *
 * @module components/skill/SkillVersionsBrowserModal
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SkillVersionList } from "@/components/skill/SkillVersionList";
import { useToastStore } from "@/stores/toastStore";
import { translateError } from "@/utils/translateError";
import type { AuditRecord } from "@/types/audit";
import type { SkillVersionEntry } from "@/types/domain";

export interface SkillVersionsBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  versions: SkillVersionEntry[];
  currentVersion: string;
  latestVersion: string;
  canManage: boolean;
  /**
   * Per-version audit summary keyed by version string. Versions absent
   * render a "not audited" pill in the list. `undefined` suppresses
   * audit pills entirely.
   */
  // exactOptionalPropertyTypes (#657)
  auditSummary?: Record<string, AuditRecord> | undefined;
  /** Fire when the user picks a version. Null = jump back to latest. */
  onSelectVersion: (versionOrNull: string | null) => void;
  // exactOptionalPropertyTypes (#657)
  onToggleDeprecation?: ((args: {
    version: string;
    isDeprecated: boolean;
    deprecationNote?: string | undefined;
  }) => Promise<void> | void) | undefined;
  deprecationPending: boolean;
  deleteVersionPending: boolean;
  deleteVersionAsync: (version: string) => Promise<unknown>;
  /** Hooked when the user clicks "Compare versions". */
  onOpenDiff: () => void;
}

export function SkillVersionsBrowserModal({
  isOpen,
  onClose,
  versions,
  currentVersion,
  latestVersion,
  canManage,
  auditSummary,
  onSelectVersion,
  onToggleDeprecation,
  deprecationPending,
  deleteVersionPending,
  deleteVersionAsync,
  onOpenDiff,
}: SkillVersionsBrowserModalProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("skillDetail.versionsTitle", "All versions") as string}
      className="!max-w-3xl"
    >
      {versions.length >= 2 && (
        <div className="mb-4 flex justify-end">
          <Button variant="secondary" size="sm" onClick={onOpenDiff}>
            {t("versionDiff.openButton", "Compare versions")}
          </Button>
        </div>
      )}
      <SkillVersionList
        versions={versions}
        currentVersion={currentVersion}
        onSelect={(v) => {
          onSelectVersion(v === latestVersion ? null : v);
          onClose();
        }}
        canManage={canManage}
        onToggleDeprecation={onToggleDeprecation}
        isMutating={deprecationPending}
        isDeleting={deleteVersionPending}
        auditSummary={auditSummary}
        onDeleteVersion={async (version) => {
          try {
            await deleteVersionAsync(version);
            // If the version the user just deleted was the one
            // currently being viewed, reset to latest so the page
            // doesn't 404 on the next render.
            if (currentVersion === version) onSelectVersion(null);
            addToast({
              type: "success",
              message: t("skillDetail.versionDeleted", "Version v{{version}} deleted", {
                version,
              }),
            });
          } catch (err) {
            addToast({
              type: "error",
              message: translateError(
                err,
                t("skillDetail.versionDeleteFailed", "Failed to delete version"),
              ),
            });
          }
        }}
      />
    </Modal>
  );
}
