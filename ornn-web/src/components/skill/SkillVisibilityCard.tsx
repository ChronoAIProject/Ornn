/**
 * Right-rail "Visibility" card extracted from SkillDetailPage (#453).
 *
 * Renders the three-tier visibility ladder:
 *   public  — `isPrivate: false`
 *   limited — `isPrivate: true` AND at least one explicit grant
 *   private — `isPrivate: true` AND no grants — only the author +
 *             platform admins can see it.
 *
 * Plus a per-tier-colored pill, user/org grant counts, and a "Manage
 * permissions" button for the owner. The actual permissions editor
 * lives in `PermissionsModal`; this card just opens it.
 *
 * @module components/skill/SkillVisibilityCard
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { RailCard } from "@/components/detail/RailCard";

type Tier = "public" | "limited" | "private";

export interface SkillVisibilityCardProps {
  isPrivate: boolean;
  sharedWithUsersCount: number;
  sharedWithOrgsCount: number;
  /** How many grants confer write (#1123). Shown as a "can edit" line. */
  writeCount?: number;
  isOwner: boolean;
  onManagePermissions: () => void;
}

export function SkillVisibilityCard({
  isPrivate,
  sharedWithUsersCount,
  sharedWithOrgsCount,
  writeCount = 0,
  isOwner,
  onManagePermissions,
}: SkillVisibilityCardProps) {
  const { t } = useTranslation();
  const hasGrants = sharedWithUsersCount > 0 || sharedWithOrgsCount > 0;
  const tier: Tier = !isPrivate ? "public" : hasGrants ? "limited" : "private";

  const tierClass: Record<Tier, string> = {
    public: "border-success/40 bg-success-soft text-success",
    limited: "border-warning/40 bg-warning-soft text-warning",
    private: "border-info/40 bg-info-soft text-info",
  };
  const tierLabel: Record<Tier, string> = {
    public: t("common.public", "Public"),
    limited: t("common.limited", "Limited access"),
    private: t("common.private", "Private"),
  };

  return (
    <RailCard
      title={t("skillDetail.cardVisibility", "Visibility")}
      icon={
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" />
          <path d="M12 3a14 14 0 0 1 4 9 14 14 0 0 1-4 9 14 14 0 0 1-4-9 14 14 0 0 1 4-9z" />
        </svg>
      }
    >
      <span
        className={`mb-3 inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider ${tierClass[tier]}`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {tier === "public" ? (
            <>
              <circle cx="12" cy="12" r="9" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </>
          ) : tier === "limited" ? (
            <>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </>
          ) : (
            <path d="M12 2a5 5 0 0 0-5 5v3H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V7a5 5 0 0 0-5-5z" />
          )}
        </svg>
        {tierLabel[tier]}
      </span>
      <ul className="space-y-1.5 font-text text-sm text-body">
        <li className="flex items-baseline gap-2.5">
          <span className="min-w-[18px] text-right font-mono text-sm font-semibold text-strong">
            {sharedWithUsersCount}
          </span>
          <span className="text-xs text-meta">{t("skillDetail.shareUsers", "users")}</span>
        </li>
        <li className="flex items-baseline gap-2.5">
          <span className="min-w-[18px] text-right font-mono text-sm font-semibold text-strong">
            {sharedWithOrgsCount}
          </span>
          <span className="text-xs text-meta">
            {t("skillDetail.shareOrgs", "organizations")}
          </span>
        </li>
        {writeCount > 0 && (
          <li className="flex items-baseline gap-2.5">
            <span className="min-w-[18px] text-right font-mono text-sm font-semibold text-accent">
              {writeCount}
            </span>
            <span className="text-xs text-meta">{t("skillDetail.shareCanEdit", "can edit")}</span>
          </li>
        )}
      </ul>
      {isOwner && (
        <div className="mt-3.5">
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={onManagePermissions}
          >
            {t("skillDetail.managePermissions", "Manage permissions")}
          </Button>
        </div>
      )}
    </RailCard>
  );
}
