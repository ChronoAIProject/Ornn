/**
 * SkillsetMemberViewer — the skillset detail page's left pane (#1080).
 *
 * A member selector (a row of clickable skill chips) + a READ-ONLY
 * `SkillPackagePreview` of the selected member skill's files — mirroring the
 * skill detail page's package pane so a skillset reads like "a workshop of its
 * member skills". The user clicks a member to view its content.
 *
 * Data path (all read-only — NO skill mutation, NO closure write):
 *   member ref `name@version`
 *     → `useSkill(name, version)`        → SkillDetail (carries presigned URL)
 *     → `useSkillPackage(presignedUrl)`  → FileNode tree + text contents map
 *     → `<SkillPackagePreview>`          → file tree + viewer
 *
 * ACL is enforced upstream: a member the caller can't see (private / removed)
 * surfaces an access message rather than its files.
 *
 * @module components/skillset/SkillsetMemberViewer
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { Skeleton } from "@/components/ui/Skeleton";
import { useSkill } from "@/hooks/useSkills";
import { useSkillPackage } from "@/hooks/useSkillPackage";
import { parseMemberRef } from "@/types/skillset";

export interface SkillsetMemberViewerProps {
  /** Member refs (`name@version`) of the skillset version being viewed. */
  members: string[];
}

export function SkillsetMemberViewer({ members }: SkillsetMemberViewerProps) {
  const { t } = useTranslation();
  const [selectedRef, setSelectedRef] = useState<string | null>(members[0] ?? null);

  // Keep the selection valid if `members` changes (version switch / edit).
  const activeRef =
    selectedRef && members.includes(selectedRef) ? selectedRef : (members[0] ?? null);
  const parsed = activeRef ? parseMemberRef(activeRef) : null;

  const {
    data: skill,
    isLoading: skillLoading,
    error: skillError,
  } = useSkill(parsed?.name ?? "", parsed?.version || undefined);
  const {
    files,
    fileContents,
    isLoading: pkgLoading,
    error: pkgError,
  } = useSkillPackage(skill?.presignedPackageUrl);

  const loading = skillLoading || (!!skill && pkgLoading);

  return (
    <section
      className="card-impression flex min-h-[420px] flex-col overflow-hidden rounded border border-subtle bg-card lg:flex-1 lg:min-h-0 lg:min-w-0"
      data-testid="skillset-member-viewer"
    >
      {/* Member selector — click a skill in the set to view its package. */}
      <div
        className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-subtle bg-elevated px-3 py-2"
        data-testid="member-tabs"
      >
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
          {t("skillsetDetail.membersLabel", "Members")}
        </span>
        {members.map((ref) => {
          const { name, version } = parseMemberRef(ref);
          const isActive = ref === activeRef;
          return (
            <button
              key={ref}
              type="button"
              onClick={() => setSelectedRef(ref)}
              aria-pressed={isActive}
              className={`shrink-0 rounded-sm border px-2.5 py-1 font-mono text-xs transition-colors cursor-pointer ${
                isActive
                  ? "border-accent bg-accent/15 text-strong"
                  : "border-subtle bg-card text-meta hover:border-accent hover:text-strong"
              }`}
            >
              <span className="max-w-[12rem] truncate align-middle">{name}</span>
              {version && <span className="text-meta">@{version}</span>}
            </button>
          );
        })}
      </div>

      {/* Selected member's package — read-only file tree + viewer. */}
      <div className="flex-1 min-h-0">
        {!activeRef ? (
          <p className="py-12 text-center font-text text-sm text-meta">
            {t("skillsetDetail.noMembers", "This skillset has no members.")}
          </p>
        ) : loading ? (
          <div className="p-6">
            <Skeleton lines={8} />
          </div>
        ) : skillError || !skill ? (
          <p className="px-6 py-12 text-center font-text text-sm text-meta">
            {t(
              "skillsetDetail.memberUnavailable",
              "This member skill isn't available to you — it may be private or removed.",
            )}
          </p>
        ) : pkgError ? (
          <p className="px-6 py-12 text-center font-text text-sm text-meta">
            {t("skillsetDetail.memberPackageError", "Couldn't load this skill's files.")}
          </p>
        ) : files.length > 0 ? (
          // key on the member ref so switching remounts the preview — avoids a
          // one-frame flash of the previous member's files while the new
          // package effect kicks in.
          <SkillPackagePreview
            key={activeRef}
            files={files}
            fileContents={fileContents}
            metadata={null}
            className="h-full"
          />
        ) : (
          <p className="px-6 py-12 text-center font-text text-sm text-meta">
            {t("skillsetDetail.memberNoFiles", "This skill has no viewable files.")}
          </p>
        )}
      </div>
    </section>
  );
}
