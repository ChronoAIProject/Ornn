/**
 * KindBadge — renders a skillset's `kind` as a Forge-styled Badge.
 *
 *   generic              → muted   ("Bundle")
 *   consensus-supported  → cyan/ember ("Consensus")
 *
 * `consensus-supported` is an author CLAIM (not a platform guarantee), so the
 * label reads as a typed tag, not a trust badge — the detail page carries the
 * fuller "author asserts" framing.
 *
 * @module components/skillset/KindBadge
 */

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/Badge";
import type { BadgeProps } from "@/components/ui/Badge";
import type { SkillsetKind } from "@/types/skillset";

export interface KindBadgeProps {
  kind: SkillsetKind;
  className?: string | undefined;
}

const KIND_COLOR: Record<SkillsetKind, NonNullable<BadgeProps["color"]>> = {
  generic: "muted",
  "consensus-supported": "cyan",
};

export function KindBadge({ kind, className = "" }: KindBadgeProps) {
  const { t } = useTranslation();
  const label =
    kind === "consensus-supported"
      ? t("skillsetKind.consensusSupported", "Consensus")
      : t("skillsetKind.generic", "Bundle");
  return (
    <Badge color={KIND_COLOR[kind]} className={className}>
      {label}
    </Badge>
  );
}
