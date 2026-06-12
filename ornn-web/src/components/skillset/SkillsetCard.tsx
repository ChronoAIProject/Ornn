/**
 * SkillsetCard — one browse-grid card for a skillset search result.
 *
 * Mirrors `SkillCard`: title row, kind + visibility badges, description,
 * tags, author + timestamp footer, optional owner Edit/Delete controls.
 *
 * NOTE (#969 follow-up): `SkillsetSearchItem.memberCount` is hardcoded `0`
 * in the backend search service — the identity doc the search reads doesn't
 * carry the member list. So this card DELIBERATELY does not surface a member
 * count; the real count lives on the detail page (resolved from the version).
 *
 * @module components/skillset/SkillsetCard
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { BadgeProps } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { KindBadge } from "@/components/skillset/KindBadge";
import type { SkillsetSearchItem } from "@/types/skillset";
import { formatDateSGT } from "@/utils/formatters";

const TAG_COLORS: NonNullable<BadgeProps["color"]>[] = ["cyan", "magenta", "yellow", "green"];

function getTagColor(tag: string): NonNullable<BadgeProps["color"]> {
  const hash = tag.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return TAG_COLORS[hash % TAG_COLORS.length]!;
}

export interface SkillsetCardProps {
  skillset: SkillsetSearchItem;
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  showOwnerControls?: boolean | undefined;
  currentUserId?: string | undefined;
  onEdit?: ((skillset: SkillsetSearchItem) => void) | undefined;
  onDelete?: ((skillset: SkillsetSearchItem) => void) | undefined;
  className?: string | undefined;
}

export function SkillsetCard({
  skillset,
  showOwnerControls = false,
  currentUserId,
  onEdit,
  onDelete,
  className = "",
}: SkillsetCardProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const isOwner = currentUserId && skillset.createdBy === currentUserId;
  const displayName =
    skillset.createdByDisplayName || skillset.createdByEmail || skillset.createdBy;
  const timestamp = skillset.updatedOn || skillset.createdOn;

  return (
    <Card
      hoverable
      onClick={() => navigate(`/skillsets/${skillset.name}`)}
      className={`flex flex-col h-full ${className}`}
    >
      {/* Title — full card width, wrap up to two lines then ellipsis. */}
      <h3 className="mb-2 font-display text-lg font-semibold text-accent break-words line-clamp-2">
        {skillset.name}
      </h3>

      {/* Kind + visibility badges — mirrors SkillCard's badge row weight (no
          version badge: SkillCard surfaces version only on the detail page, not
          in the grid). No member count (sourced 0 from search). */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <KindBadge kind={skillset.kind} />
        {skillset.isPrivate ? (
          <Badge color="cyan">🔒 {t("common.private")}</Badge>
        ) : (
          <Badge color="green">🌐 {t("common.public")}</Badge>
        )}
      </div>

      {/* Description — fixed 2 lines, break long words. */}
      <p className="mb-4 font-text text-sm leading-relaxed text-meta line-clamp-2 break-words">
        {skillset.description}
      </p>

      {/* Tags — fixed single row. */}
      <div className="mb-3 flex flex-wrap gap-1.5 min-h-[24px]">
        {skillset.tags.slice(0, 5).map((tag) => (
          <Badge key={tag} color={getTagColor(tag)}>
            {tag}
          </Badge>
        ))}
      </div>

      {/* Spacer to push footer to bottom. */}
      <div className="flex-1" />

      {/* Author + timestamp. */}
      <div className="flex items-center justify-between gap-4 text-xs text-meta">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-elevated text-[8px] text-meta shrink-0">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <span className="truncate">{displayName}</span>
        </div>
        <span className="shrink-0">
          {formatDateSGT(timestamp, i18n.language, { withSeconds: true })}
        </span>
      </div>

      {showOwnerControls && isOwner && (
        <div className="mt-4 pt-4 border-t border-accent/10">
          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            {onEdit && (
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e?.stopPropagation();
                  onEdit(skillset);
                }}
              >
                {t("common.edit")}
              </Button>
            )}
            {onDelete && (
              <Button
                variant="danger"
                size="sm"
                onClick={(e) => {
                  e?.stopPropagation();
                  onDelete(skillset);
                }}
              >
                {t("common.delete")}
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
