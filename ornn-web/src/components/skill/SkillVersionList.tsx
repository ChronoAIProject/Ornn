import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { SkillVersionEntry } from "@/types/domain";

/** Format a date string to exact SGT (Asia/Singapore) timestamp. */
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

export interface SkillVersionListProps {
  versions: SkillVersionEntry[];
  currentVersion: string;
  /** Fire when the user clicks a version row to switch to it. */
  onSelect: (version: string) => void;
  /** Show owner-only controls (deprecation toggle). */
  canManage: boolean;
  /** Fire when the deprecation flag changes; receives the target version. */
  onToggleDeprecation?: (args: {
    version: string;
    isDeprecated: boolean;
    deprecationNote?: string;
  }) => Promise<void> | void;
  /** Whether a deprecation mutation is currently in flight (for loading state). */
  isMutating?: boolean;
  className?: string;
}

/**
 * Compact version history list rendered in the detail-page sidebar.
 * Clicking a row switches the page to that version. Owner / admin sees a
 * "mark deprecated / undeprecate" action per row; clicking it opens a modal
 * that optionally captures a note before confirming.
 */
export function SkillVersionList({
  versions,
  currentVersion,
  onSelect,
  canManage,
  onToggleDeprecation,
  isMutating = false,
  className = "",
}: SkillVersionListProps) {
  const { t } = useTranslation();
  const [modalTarget, setModalTarget] = useState<SkillVersionEntry | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const latestVersion = versions[0]?.version;

  const openDeprecationModal = (entry: SkillVersionEntry) => {
    setModalTarget(entry);
    setNoteDraft(entry.deprecationNote ?? "");
  };
  const closeModal = () => {
    setModalTarget(null);
    setNoteDraft("");
  };

  const confirmToggle = async () => {
    if (!modalTarget || !onToggleDeprecation) return;
    await onToggleDeprecation({
      version: modalTarget.version,
      isDeprecated: !modalTarget.isDeprecated,
      deprecationNote: modalTarget.isDeprecated ? undefined : noteDraft.trim() || undefined,
    });
    closeModal();
  };

  if (versions.length === 0) {
    return null;
  }

  return (
    <div className={`glass rounded-xl p-5 space-y-3 ${className}`}>
      <p className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
        {t("skillDetail.versions")}
      </p>
      <ul className="space-y-1.5">
        {versions.map((v) => {
          const isCurrent = v.version === currentVersion;
          const isLatest = v.version === latestVersion;
          return (
            <li
              key={v.version}
              className={`
                rounded-lg border p-2.5 transition-colors
                ${
                  isCurrent
                    ? "border-neon-cyan/40 bg-neon-cyan/5"
                    : "border-transparent bg-bg-elevated/40 hover:border-neon-cyan/20"
                }
              `}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => !isCurrent && onSelect(v.version)}
                  disabled={isCurrent}
                  className={`
                    flex-1 min-w-0 text-left
                    ${isCurrent ? "cursor-default" : "cursor-pointer"}
                  `}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-sm text-text-primary">{v.version}</span>
                    {isLatest && (
                      <Badge color="cyan" className="text-[10px]">
                        {t("skillDetail.latest")}
                      </Badge>
                    )}
                    {v.isDeprecated && (
                      <Badge color="yellow" className="text-[10px]">
                        {t("skillDetail.deprecated")}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 font-body text-xs text-text-muted truncate">
                    {formatDateSGT(v.createdOn)}
                    {v.createdByDisplayName ? ` · ${v.createdByDisplayName}` : ""}
                  </div>
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => openDeprecationModal(v)}
                    disabled={isMutating}
                    className="
                      shrink-0 rounded border border-transparent px-2 py-1
                      font-body text-xs text-text-muted
                      hover:text-neon-yellow hover:border-neon-yellow/30
                      disabled:opacity-50 disabled:cursor-not-allowed
                      transition-colors cursor-pointer
                    "
                  >
                    {v.isDeprecated
                      ? t("skillDetail.unmarkDeprecated")
                      : t("skillDetail.markDeprecated")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        isOpen={modalTarget !== null}
        onClose={closeModal}
        title={t("skillDetail.deprecationModalTitle", { version: modalTarget?.version ?? "" })}
      >
        {modalTarget && !modalTarget.isDeprecated && (
          <div className="space-y-2">
            <label
              htmlFor="deprecation-note"
              className="font-heading text-[11px] uppercase tracking-wider text-text-muted"
            >
              {t("skillDetail.deprecationNoteLabel")}
            </label>
            <textarea
              id="deprecation-note"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              maxLength={1024}
              rows={3}
              placeholder={t("skillDetail.deprecationNotePlaceholder")}
              className="
                neon-input w-full rounded-lg px-3 py-2 font-body text-sm
                text-text-primary resize-y
              "
            />
          </div>
        )}
        {modalTarget?.isDeprecated && modalTarget.deprecationNote && (
          <p className="font-body text-sm text-text-muted">
            {t("skillDetail.deprecationBannerBody", { note: modalTarget.deprecationNote })}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={closeModal}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" loading={isMutating} onClick={confirmToggle}>
            {modalTarget?.isDeprecated
              ? t("skillDetail.unmarkDeprecated")
              : t("skillDetail.markDeprecated")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
