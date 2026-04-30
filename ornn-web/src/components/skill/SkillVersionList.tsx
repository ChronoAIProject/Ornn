import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { SkillVersionEntry } from "@/types/domain";
import type { AuditRecord, AuditVerdict } from "@/types/audit";

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
  /** Show owner-only controls (deprecation toggle, delete). */
  canManage: boolean;
  /** Fire when the deprecation flag changes; receives the target version. */
  onToggleDeprecation?: (args: {
    version: string;
    isDeprecated: boolean;
    deprecationNote?: string;
  }) => Promise<void> | void;
  /** Whether a deprecation mutation is currently in flight (for loading state). */
  isMutating?: boolean;
  /** Fire when the user confirms a non-latest version delete. */
  onDeleteVersion?: (version: string) => Promise<void> | void;
  /** Whether a delete mutation is currently in flight (for loading state). */
  isDeleting?: boolean;
  /**
   * Optional per-version audit summary. Versions present render their
   * verdict pill (green / yellow / red); versions absent render a
   * neutral "not audited" pill. Pass `undefined` to suppress audit
   * pills entirely (e.g. on the explore page).
   */
  auditSummary?: Record<string, AuditRecord>;
  className?: string;
}

/**
 * Compact version history list rendered in the detail-page sidebar.
 * Clicking a row switches the page to that version. Owner / admin sees a
 * "mark deprecated / undeprecate" action per row; clicking it opens a modal
 * that optionally captures a note before confirming.
 */
function AuditPill({
  audit,
  notAuditedLabel,
}: {
  audit?: AuditRecord;
  notAuditedLabel: string;
}) {
  if (!audit) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-text-muted/30 bg-text-muted/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-meta"
        title={notAuditedLabel}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-text-muted/60" aria-hidden />
        ?
      </span>
    );
  }
  const cls: Record<AuditVerdict, string> = {
    green:
      "border-accent/40 bg-accent/10 text-accent",
    yellow:
      "border-warning/40 bg-warning/10 text-warning",
    red:
      "border-danger/40 bg-danger/10 text-danger",
  };
  const dotCls: Record<AuditVerdict, string> = {
    green: "bg-accent",
    yellow: "bg-warning",
    red: "bg-danger",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls[audit.verdict]}`}
      title={`Audit ${audit.verdict} · ${audit.overallScore.toFixed(1)}/10`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotCls[audit.verdict]}`} aria-hidden />
      {audit.overallScore.toFixed(1)}
    </span>
  );
}

export function SkillVersionList({
  versions,
  currentVersion,
  onSelect,
  canManage,
  onToggleDeprecation,
  isMutating = false,
  onDeleteVersion,
  isDeleting = false,
  auditSummary,
  className = "",
}: SkillVersionListProps) {
  const { t } = useTranslation();
  const [modalTarget, setModalTarget] = useState<SkillVersionEntry | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SkillVersionEntry | null>(null);
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

  const confirmDelete = async () => {
    if (!deleteTarget || !onDeleteVersion) return;
    await onDeleteVersion(deleteTarget.version);
    setDeleteTarget(null);
  };

  if (versions.length === 0) {
    return null;
  }

  return (
    <div className={`glass rounded-xl p-5 space-y-3 ${className}`}>
      <p className="font-display text-[11px] uppercase tracking-wider text-meta">
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
                    ? "border-accent/40 bg-accent/5"
                    : "border-transparent bg-elevated/40 hover:border-accent/20"
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
                    <span className="font-mono text-sm text-strong">{v.version}</span>
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
                    {auditSummary && (
                      <AuditPill
                        audit={auditSummary[v.version]}
                        notAuditedLabel={
                          t("audit.notAuditedYet", "Not audited yet") as string
                        }
                      />
                    )}
                  </div>
                  <div className="mt-0.5 font-text text-xs text-meta truncate">
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
                      font-text text-xs text-meta
                      hover:text-warning hover:border-warning/30
                      disabled:opacity-50 disabled:cursor-not-allowed
                      transition-colors cursor-pointer
                    "
                  >
                    {v.isDeprecated
                      ? t("skillDetail.unmarkDeprecated")
                      : t("skillDetail.markDeprecated")}
                  </button>
                )}
                {canManage && onDeleteVersion && (() => {
                  const isOnly = versions.length <= 1;
                  // Backend rejects deleting the only-remaining version
                  // (use the danger-zone "Delete skill" instead) and the
                  // current latest (publish a newer version first). We
                  // mirror that here as a disabled button with a tooltip
                  // so the affordance stays discoverable.
                  const blockedReason = isOnly
                    ? (t(
                        "skillDetail.deleteVersionBlockedOnly",
                        "Can't delete the only remaining version. Use 'Delete skill' in the danger zone instead.",
                      ) as string)
                    : isLatest
                      ? (t(
                          "skillDetail.deleteVersionBlockedLatest",
                          "Can't delete the current latest version. Publish a newer version first, then delete this one.",
                        ) as string)
                      : null;
                  const isBlocked = blockedReason !== null;
                  return (
                    <button
                      type="button"
                      onClick={() => !isBlocked && setDeleteTarget(v)}
                      disabled={isDeleting || isBlocked}
                      title={
                        blockedReason ??
                        (t("skillDetail.deleteVersion", "Delete this version") as string)
                      }
                      className="
                        shrink-0 rounded border border-transparent px-2 py-1
                        font-text text-xs text-meta
                        hover:text-danger hover:border-danger/40
                        disabled:opacity-50 disabled:cursor-not-allowed
                        disabled:hover:text-meta disabled:hover:border-transparent
                        transition-colors cursor-pointer
                      "
                    >
                      {t("common.delete")}
                    </button>
                  );
                })()}
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
              className="font-display text-[11px] uppercase tracking-wider text-meta"
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
                neon-input w-full rounded-lg px-3 py-2 font-text text-sm
                text-strong resize-y
              "
            />
          </div>
        )}
        {modalTarget?.isDeprecated && modalTarget.deprecationNote && (
          <p className="font-text text-sm text-meta">
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

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={
          t("skillDetail.deleteVersionTitle", {
            defaultValue: "Delete v{{version}}?",
            version: deleteTarget?.version ?? "",
          }) as string
        }
      >
        <p className="font-text text-sm text-meta">
          {t("skillDetail.deleteVersionConfirm", {
            defaultValue:
              "Are you sure you want to delete v{{version}}? The version's package zip and audit history are removed and this cannot be undone.",
            version: deleteTarget?.version ?? "",
          })}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDeleteTarget(null)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={isDeleting}
            onClick={confirmDelete}
          >
            {t("common.delete")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
