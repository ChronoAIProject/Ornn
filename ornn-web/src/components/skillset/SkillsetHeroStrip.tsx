/**
 * SkillsetHeroStrip — top-of-page identity strip on the Skillset Detail Page
 * (#1067).
 *
 * Thin adapter over the shared `<DetailHeroStrip>` shell, mirroring
 * `SkillHeroStrip`. It supplies the skillset-specific icon, the tag row, the
 * status pill row (kind / visibility / version), and the action cluster
 * (version picker + owner Edit / Permissions). The card chrome and layout live
 * in `DetailHeroStrip` so both detail surfaces read identically.
 *
 * Styled in the Forge Workshop language (DESIGN.md): Space Grotesk display,
 * Inter body, JetBrains Mono pills, ember accent, hairline borders, 2-4px radii.
 *
 * @module components/skillset/SkillsetHeroStrip
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DetailHeroStrip } from "@/components/detail/DetailHeroStrip";
import { Button } from "@/components/ui/Button";
import type { SkillsetDetail } from "@/types/skillset";

export interface SkillsetHeroStripProps {
  skillset: SkillsetDetail;
  isOwner: boolean;
  /** Rendered into the actions cluster (the version popover). */
  versionPicker?: ReactNode;
  onEdit?: (() => void) | undefined;
  onManagePermissions?: (() => void) | undefined;
}

export function SkillsetHeroStrip({
  skillset,
  isOwner,
  versionPicker,
  onEdit,
  onManagePermissions,
}: SkillsetHeroStripProps) {
  const { t } = useTranslation();

  const kindLabel =
    skillset.kind === "consensus-supported"
      ? t("skillsetKind.consensusSupported", "Consensus")
      : t("skillsetKind.generic", "Bundle");

  const visibilityLabel = skillset.isPrivate
    ? t("common.private", "Private")
    : t("common.public", "Public");

  return (
    <DetailHeroStrip
      titleId="skillset-hero-name"
      title={skillset.name}
      description={skillset.description}
      icon={
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      }
      tagRow={
        skillset.tags.length > 0
          ? skillset.tags.map((tag) => (
              <span key={tag} className="text-meta">
                #{tag}
              </span>
            ))
          : undefined
      }
      pills={
        <>
          {/* Kind */}
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-info/40 bg-info-soft px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-info">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
            {kindLabel}
          </span>
          {/* Visibility */}
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-info/40 bg-info-soft px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-info">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              {skillset.isPrivate
                ? <path d="M12 2a5 5 0 0 0-5 5v3H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V7a5 5 0 0 0-5-5z" />
                : <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /></>}
            </svg>
            {visibilityLabel}
          </span>
          {/* Version */}
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-strong-edge px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-strong">
            v{skillset.version}
          </span>
        </>
      }
      actions={
        versionPicker || (isOwner && (onEdit || onManagePermissions)) ? (
          <div className="flex flex-col items-stretch gap-3 lg:items-end">
            {versionPicker}
            {isOwner && (onEdit || onManagePermissions) && (
              <div className="flex flex-wrap gap-2">
                {onEdit && (
                  <Button size="sm" onClick={onEdit}>
                    {t("common.edit")}
                  </Button>
                )}
                {onManagePermissions && (
                  <Button variant="secondary" size="sm" onClick={onManagePermissions}>
                    {t("skillsetDetail.managePermissions", "Permissions")}
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : undefined
      }
    />
  );
}
