/**
 * Owner-only "always keep skills in this skillset up to date" toggle (#1191).
 *
 * A single opt-in: when ON, every member — pinned or not — resolves to its
 * skill's latest version wherever the set is delivered (closure, plugin export,
 * visibility). The flip is reversible and low-risk (the authored member refs are
 * never rewritten — it's a resolution-time override), so it toggles directly
 * with no confirm dialog. Enabling immediately re-cuts the revision if any
 * member was behind, which the returned payload reflects.
 *
 * Owner-only: it's a management action. Non-owners see nothing here — the
 * delivered set is already latest for them when the flag is on, transparently.
 *
 * @module components/skillset/SkillsetAutoUpdateCard
 */

import { useTranslation } from "react-i18next";
import { RailCard } from "@/components/detail/RailCard";
import { Button } from "@/components/ui/Button";
import { useUpdateAutoUpdate } from "@/hooks/useSkillsets";
import { useToastStore } from "@/stores/toastStore";
import { translateError } from "@/utils/translateError";
import type { SkillsetDetail } from "@/types/skillset";

export interface SkillsetAutoUpdateCardProps {
  skillset: SkillsetDetail;
  isOwner: boolean;
  /** URL id (name OR guid) the detail page was opened with — the cache key. */
  idOrName: string;
}

export function SkillsetAutoUpdateCard({
  skillset,
  isOwner,
  idOrName,
}: SkillsetAutoUpdateCardProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const mutation = useUpdateAutoUpdate(skillset.guid, idOrName);

  // Owner-only management action.
  if (!isOwner) return null;

  const on = skillset.autoUpdateMembers;

  async function toggle() {
    try {
      await mutation.mutateAsync({ enabled: !on });
      addToast({
        type: "success",
        message: on
          ? t("skillsetAutoUpdate.offSuccess", "Auto-update turned off")
          : t("skillsetAutoUpdate.onSuccess", "Auto-update turned on"),
      });
    } catch (err) {
      addToast({ type: "error", message: translateError(err) });
    }
  }

  return (
    <RailCard
      title={t("skillsetAutoUpdate.cardTitle", "Keep skills up to date")}
      icon={
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M23 4v6h-6" />
          <path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      }
    >
      <p className="mb-3 font-mono text-[11px] leading-relaxed text-meta">
        {t(
          "skillsetAutoUpdate.explain",
          "When on, every member always uses its skill's latest version — pinned versions are overridden. New member versions flow into this skillset (and its plugin) automatically.",
        )}
      </p>
      <div className="flex items-center justify-between gap-3">
        <span
          className={`font-mono text-[10px] font-semibold uppercase tracking-[0.16em] ${
            on ? "text-ember" : "text-meta"
          }`}
        >
          {on
            ? t("skillsetAutoUpdate.stateOn", "On — tracking latest")
            : t("skillsetAutoUpdate.stateOff", "Off — using pinned versions")}
        </span>
        <Button
          variant={on ? "secondary" : "primary"}
          size="sm"
          loading={mutation.isPending}
          onClick={toggle}
        >
          {on
            ? t("skillsetAutoUpdate.turnOff", "Turn off")
            : t("skillsetAutoUpdate.turnOn", "Turn on")}
        </Button>
      </div>
    </RailCard>
  );
}
