/**
 * SkillsetDerivedVisibilityCard — right-rail "Visibility" card for a skillset
 * (#1136). Read-only: a skillset has NO owner-set visibility, so unlike the
 * skill `SkillVisibilityCard` there is no "Manage permissions" action.
 *
 * The state is DERIVED from the member skills:
 *   all-public   → green   — every member public; anyone can use / discover it.
 *   restricted   → yellow  — ≥1 private member; only callers who can read all
 *                            members can use / discover it.
 *   unresolvable → red     — ≥1 member no longer resolves (deleted skill).
 *
 * To widen a skillset's reach, expose the underlying member skills — the card
 * explains this so the owner isn't left looking for a control that doesn't
 * exist.
 *
 * @module components/skillset/SkillsetDerivedVisibilityCard
 */

import { useTranslation } from "react-i18next";
import { RailCard } from "@/components/detail/RailCard";
import { SkillsetVisibilityBadge } from "@/components/skillset/SkillsetVisibilityBadge";
import type { SkillsetMemberVisibilityState } from "@/types/skillset";

export interface SkillsetDerivedVisibilityCardProps {
  state: SkillsetMemberVisibilityState;
  /** Member refs the owner can't read (drives the repair hint). Owner-only. */
  unreadableCount: number;
  isOwner: boolean;
}

export function SkillsetDerivedVisibilityCard({
  state,
  unreadableCount,
  isOwner,
}: SkillsetDerivedVisibilityCardProps) {
  const { t } = useTranslation();

  const explain =
    state === "all-public"
      ? t(
          "skillsetDetail.visibilityCard.allPublic",
          "Every member skill is public, so anyone can use and discover this skillset.",
        )
      : state === "restricted"
        ? t(
            "skillsetDetail.visibilityCard.restricted",
            "At least one member skill is private, so only people who can read every member can use or discover this skillset.",
          )
        : t(
            "skillsetDetail.visibilityCard.unresolvable",
            "A member skill no longer exists, so this skillset can't be fully resolved. Publish a new version without it.",
          );

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
      <SkillsetVisibilityBadge state={state} className="mb-3" />
      <p className="font-text text-xs leading-relaxed text-meta">{explain}</p>
      {/* Derived, not owner-set — make that explicit so the owner doesn't
          hunt for a control that isn't here. */}
      <p className="mt-2 font-text text-xs leading-relaxed text-meta">
        {t(
          "skillsetDetail.visibilityCard.derivedNote",
          "Visibility is derived from the members — to widen reach, share the underlying skills.",
        )}
      </p>
      {isOwner && unreadableCount > 0 && (
        <p className="mt-2 font-mono text-[11px] text-warning">
          {t(
            "skillsetDetail.visibilityCard.unreadableHint",
            "Some members are no longer readable by you.",
          )}
        </p>
      )}
    </RailCard>
  );
}
