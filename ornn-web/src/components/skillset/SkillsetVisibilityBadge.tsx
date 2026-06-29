/**
 * SkillsetVisibilityBadge — renders a skillset's DERIVED visibility (#1136)
 * as a read-only Forge Badge.
 *
 *   all-public    → green   ("Public")    — every member public; anyone can use it.
 *   restricted    → yellow  ("Restricted") — ≥1 private member; only callers who
 *                                            can read all members can use it.
 *   unresolvable  → red     ("Broken")    — ≥1 member ref no longer resolves.
 *
 * A skillset has NO owner-set visibility — its reach is bounded by its
 * least-privileged member, so this badge is informational only (never a
 * control). To widen a skillset's reach, expose the underlying member skills.
 *
 * @module components/skillset/SkillsetVisibilityBadge
 */

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/Badge";
import type { BadgeProps } from "@/components/ui/Badge";
import type { SkillsetMemberVisibilityState } from "@/types/skillset";

export interface SkillsetVisibilityBadgeProps {
  state: SkillsetMemberVisibilityState;
  className?: string | undefined;
}

const STATE_COLOR: Record<SkillsetMemberVisibilityState, NonNullable<BadgeProps["color"]>> = {
  "all-public": "green",
  restricted: "yellow",
  unresolvable: "red",
};

export function SkillsetVisibilityBadge({ state, className = "" }: SkillsetVisibilityBadgeProps) {
  const { t } = useTranslation();
  const label =
    state === "all-public"
      ? t("skillsetVisibility.public", "Public")
      : state === "restricted"
        ? t("skillsetVisibility.restricted", "Restricted")
        : t("skillsetVisibility.broken", "Broken");
  return (
    <Badge color={STATE_COLOR[state]} className={className}>
      {label}
    </Badge>
  );
}
