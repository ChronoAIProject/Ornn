/**
 * Passive auto-sync status pill (#1178), driven by `source.driftState`.
 *
 * Read-only — it reflects what the scheduled drift check / auto-publish
 * (#1176/#1177) recorded on the skill's GitHub source. It is NOT an action;
 * the manual "Refresh from GitHub" button remains the override.
 *
 * Renders nothing until the first drift check has run (no `driftState`), or
 * for non-GitHub sources — so legacy skills look unchanged.
 *
 * @module components/skill/SourceDriftBadge
 */

import { useTranslation } from "react-i18next";
import type { SkillSource } from "@/types/domain";

/** Compact relative-time ("5m ago", "2h ago", "3d ago", "just now"). */
function relativeTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const deltaSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(deltaSec), "second");
  if (abs < 3600) return rtf.format(Math.round(deltaSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(deltaSec / 3600), "hour");
  return rtf.format(Math.round(deltaSec / 86400), "day");
}

export function SourceDriftBadge({
  source,
  className,
}: {
  source: SkillSource | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!source || source.type !== "github" || !source.driftState) return null;

  // Tone classes are DESIGN.md semantic state tokens only (no invented palette).
  // State color is never the sole signal — each variant pairs copy + border.
  let tone: string;
  let label: string;
  let title: string | undefined;

  switch (source.driftState) {
    case "in_sync": {
      const when = relativeTime(source.lastSyncedAt);
      tone = "text-success bg-success-soft border-success/40";
      label = when
        ? t("sourceDrift.inSyncAt", "Auto-synced {{when}}", { when })
        : t("sourceDrift.inSync", "Auto-synced");
      title = t("sourceDrift.inSyncTitle", "Automatically kept in sync with the GitHub source.");
      break;
    }
    case "drifted":
      tone = "text-info bg-info-soft border-info/40";
      label = t("sourceDrift.drifted", "Update in progress");
      title = t(
        "sourceDrift.driftedTitle",
        "Upstream changed — a new version is being published automatically.",
      );
      break;
    case "changed_unversioned":
      tone = "text-warning bg-warning-soft border-warning/40";
      label = t("sourceDrift.changedUnversioned", "Upstream changed — version not bumped");
      title = t(
        "sourceDrift.changedUnversionedTitle",
        "The GitHub source changed but its SKILL.md version was not increased, so no new version was published. Bump the version upstream to resume auto-sync.",
      );
      break;
    case "broken":
      tone = "text-danger bg-danger-soft border-danger/30";
      label = t("sourceDrift.broken", "Source unavailable");
      title = t(
        "sourceDrift.brokenTitle",
        "The GitHub source could not be reached (deleted, made private, or the branch/tag was removed). Re-link the skill to resume auto-sync.",
      );
      break;
    default:
      return null;
  }

  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-text text-xs ${tone} ${className ?? ""}`}
      title={title}
    >
      {label}
    </span>
  );
}
