/**
 * SkillsetHeroStrip — top-of-page identity strip on the Skillset Detail Page
 * (#1067).
 *
 * Thin adapter over the shared `<DetailHeroStrip>` shell, mirroring
 * `SkillHeroStrip`. It supplies the skillset-specific icon, the tag row, the
 * status pill row (kind / visibility), and the action cluster (owner Edit only).
 * Version is now a right-rail card (matching skill details). The card chrome
 * and layout live in `DetailHeroStrip` so both detail surfaces read identically.
 *
 * Styled in the Forge Workshop language (DESIGN.md): Space Grotesk display,
 * Inter body, JetBrains Mono pills, ember accent, hairline borders, 2-4px radii.
 *
 * @module components/skillset/SkillsetHeroStrip
 */

import { useTranslation } from "react-i18next";
import { DetailHeroStrip } from "@/components/detail/DetailHeroStrip";
import { Button } from "@/components/ui/Button";
import { SkillsetVisibilityBadge } from "@/components/skillset/SkillsetVisibilityBadge";
import type { SkillsetDetail } from "@/types/skillset";

export interface SkillsetHeroStripProps {
  skillset: SkillsetDetail;
  isOwner: boolean;
  onEdit?: (() => void) | undefined;
}

/** Format a date in the user's locale, abbreviated. Returns ISO on parse
 * failure. Mirrors SkillHeroStrip so both hero footers read identically. */
function formatShortDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function SkillsetHeroStrip({
  skillset,
  isOwner,
  onEdit,
}: SkillsetHeroStripProps) {
  const { t } = useTranslation();

  const kindLabel =
    skillset.kind === "consensus-supported"
      ? t("skillsetKind.consensusSupported", "Consensus")
      : t("skillsetKind.generic", "Bundle");

  const ownerName =
    skillset.createdByDisplayName || skillset.createdByEmail || skillset.createdBy;

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
          {/* Kind — neutral metal pill so the trio reads kind·visibility·version
              instead of two identical info-soft pills (the skill hero varies its
              pills the same way). */}
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-strong-edge px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-strong">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
            </svg>
            {kindLabel}
          </span>
          {/* Visibility — DERIVED from members (#1136), read-only. */}
          <SkillsetVisibilityBadge state={skillset.memberVisibilityState} />
        </>
      }
      footer={
        <>
          <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent text-page text-[10px] font-bold font-text">
            {ownerName.charAt(0).toUpperCase()}
          </span>
          <span className="text-body">
            <strong className="font-medium">{ownerName}</strong>
          </span>
          <span className="opacity-50">·</span>
          <span>{t("skillDetail.heroPublishedOn", "Published {{date}}", { date: formatShortDate(skillset.createdOn) })}</span>
          {skillset.updatedOn && skillset.updatedOn !== skillset.createdOn && (
            <>
              <span className="opacity-50">·</span>
              <span>{t("skillDetail.heroUpdatedOn", "Updated {{date}}", { date: formatShortDate(skillset.updatedOn) })}</span>
            </>
          )}
        </>
      }
      actions={
        isOwner && onEdit ? (
          <div className="flex flex-col items-stretch gap-3 lg:items-end">
            {onEdit && (
              <Button size="sm" onClick={onEdit}>
                {t("common.edit")}
              </Button>
            )}
          </div>
        ) : undefined
      }
    />
  );
}
