import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { BadgeProps } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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

/**
 * One-row permission chips derived from the skill's state. Compact:
 * Public shows a single globe chip; Private/Users/Orgs show in series
 * so an owner can see all three facets at once. Non-owners see only
 * the top-level chip (Public or Private). Counts come from
 * `permissionSummary` which the backend computes per-request.
 */
function PermissionBadges({ skill }: { skill: SkillSearchResult }) {
  if (!skill.isPrivate) {
    return <Badge color="green">🌐 Public</Badge>;
  }
  const ps = skill.permissionSummary;
  const userCount = ps?.sharedUserCount ?? 0;
  const orgCount = ps?.sharedOrgCount ?? 0;
  const hasGrants = userCount > 0 || orgCount > 0;
  return (
    <>
      {!hasGrants && <Badge color="cyan">🔒 Private</Badge>}
      {userCount > 0 && <Badge color="magenta">👥 {userCount}</Badge>}
      {orgCount > 0 && <Badge color="cyan">🏢 {orgCount}</Badge>}
    </>
  );
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

  const displayName = ownerDisplayName || skill.createdByDisplayName || skill.createdByEmail || skill.createdBy;
  const timestamp = skill.updatedOn || skill.createdOn;

  return (
    <Card
      hoverable
      onClick={handleCardClick}
      className={`flex flex-col h-full ${className}`}
    >
      {/* Title + permission/system badges */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="min-w-0 font-heading text-lg font-semibold text-neon-cyan truncate">
          {skill.name}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5 flex-wrap justify-end">
          <PermissionBadges skill={skill} />
          {skill.isSystemForMe && skill.systemForService && (
            <Badge color="yellow">⚙ {skill.systemForService.label}</Badge>
          )}
        </div>
      </div>

      {/* Access-reason sub-line — surfaces WHY the caller can see a
          non-owned skill. Rendered only when the backend populated
          `myAccessReason` with a grant-based value. */}
      {skill.myAccessReason === "shared-via-org" && (
        <p className="mb-2 font-body text-[11px] uppercase tracking-wider text-text-muted">
          Via organization
        </p>
      )}
      {skill.myAccessReason === "shared-direct" && (
        <p className="mb-2 font-body text-[11px] uppercase tracking-wider text-text-muted">
          Shared by {displayName}
        </p>
      )}

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

      {showOwnerControls && isOwner && (
        <div className="mt-4 pt-4 border-t border-neon-cyan/10">
          <div className="flex items-center justify-end gap-2">
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
