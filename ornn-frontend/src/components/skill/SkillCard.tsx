import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { BadgeProps } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SkillPublicToggle } from "./SkillPublicToggle";
import type { SkillSearchResult } from "@/types/search";

const TAG_COLORS: NonNullable<BadgeProps["color"]>[] = ["cyan", "magenta", "yellow", "green"];

function getTagColor(tag: string): NonNullable<BadgeProps["color"]> {
  const hash = tag.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return TAG_COLORS[hash % TAG_COLORS.length];
}

/** Format a date string to exact SGT (Asia/Singapore) timestamp */
function formatDateSGT(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export interface SkillCardProps {
  skill: SkillSearchResult;
  /** Show status badge and toggle (for My Skills page) */
  showOwnerControls?: boolean;
  /** Current user ID to check ownership */
  currentUserId?: string;
  /** Display name to show instead of user ID */
  ownerDisplayName?: string;
  /** Avatar URL */
  ownerAvatarUrl?: string | null;
  /** Callback when edit is clicked */
  onEdit?: (skill: SkillSearchResult) => void;
  /** Callback when delete is clicked */
  onDelete?: (skill: SkillSearchResult) => void;
  className?: string;
}

export function SkillCard({
  skill,
  showOwnerControls = false,
  currentUserId,
  ownerDisplayName,
  ownerAvatarUrl,
  onEdit,
  onDelete,
  className = "",
}: SkillCardProps) {
  const navigate = useNavigate();

  const isOwner = currentUserId && skill.createdBy === currentUserId;

  const handleCardClick = () => {
    navigate(`/skills/${skill.name}`);
  };

  const handleEditClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onEdit?.(skill);
  };

  const handleDeleteClick = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onDelete?.(skill);
  };

  const displayName = ownerDisplayName || skill.createdBy;
  const timestamp = skill.updatedOn || skill.createdOn;

  return (
    <Card
      hoverable
      onClick={handleCardClick}
      className={`flex flex-col h-full ${className}`}
    >
      {/* Title + badge */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="min-w-0 font-heading text-lg font-semibold text-neon-cyan truncate">
          {skill.name}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {showOwnerControls && (
            <Badge color={skill.isPrivate ? "cyan" : "green"}>
              {skill.isPrivate ? "Private" : "Public"}
            </Badge>
          )}
        </div>
      </div>

      {/* Description — fixed 2 lines, break long words */}
      <p className="mb-4 font-body text-sm leading-relaxed text-text-muted line-clamp-2 break-words">
        {skill.description}
      </p>

      {/* Tags — fixed single row */}
      <div className="mb-3 flex flex-wrap gap-1.5 min-h-[24px]">
        {skill.tags.slice(0, 5).map((tag) => (
          <Badge key={tag} color={getTagColor(tag)}>
            {tag}
          </Badge>
        ))}
      </div>

      {/* Spacer to push footer to bottom */}
      <div className="flex-1" />

      {/* Author + timestamp */}
      <div className="flex items-center justify-between gap-4 text-xs text-text-muted">
        <div className="flex items-center gap-2 min-w-0">
          {ownerAvatarUrl ? (
            <img
              src={ownerAvatarUrl}
              alt=""
              className="h-4 w-4 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-bg-elevated text-[8px] text-text-muted shrink-0">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="truncate">{displayName}</span>
        </div>
        <span className="shrink-0">{formatDateSGT(timestamp)}</span>
      </div>

      {/* Owner controls */}
      {showOwnerControls && isOwner && (
        <div className="mt-4 pt-4 border-t border-neon-cyan/10">
          <div className="flex items-center justify-between">
            {/* Toggle public/private */}
            <div onClick={(e) => e.stopPropagation()}>
              <SkillPublicToggle
                skillId={skill.guid}
                isPrivate={skill.isPrivate}
                size="sm"
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {onEdit && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleEditClick}
                >
                  Edit
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDeleteClick}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
