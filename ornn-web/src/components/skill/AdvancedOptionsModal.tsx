/**
 * AdvancedOptionsModal — settings-page-style modal for power-user
 * skill knobs. Two-column layout inside the modal: a left rail with
 * setting categories, and a right pane that renders whichever category
 * is selected. v1 ships with one category — "Bind to NyxID Service".
 *
 * Adding a new advanced setting:
 *   1. Add an entry to `SETTINGS`.
 *   2. Render its panel under the matching `selected === "..."` branch.
 *
 * @module components/skill/AdvancedOptionsModal
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useMyNyxidServices } from "@/hooks/useMe";
import { useTieSkillToNyxidService } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import type { SkillDetail } from "@/types/domain";

type AdvancedSettingId = "nyxid-service-binding";

interface AdvancedOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: SkillDetail;
}

/** Catalog of available settings. New settings appended here. */
const SETTINGS: ReadonlyArray<{
  id: AdvancedSettingId;
  labelKey: string;
  fallback: string;
}> = [
  {
    id: "nyxid-service-binding",
    labelKey: "advancedOptions.nyxidServiceBinding",
    fallback: "Bind to NyxID Service",
  },
];

export function AdvancedOptionsModal({ isOpen, onClose, skill }: AdvancedOptionsModalProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<AdvancedSettingId>(SETTINGS[0].id);

  // Reset to the first setting whenever the modal opens, so the user
  // always lands on a known starting point rather than wherever they
  // left off across different skills.
  useEffect(() => {
    if (isOpen) setSelected(SETTINGS[0].id);
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("advancedOptions.title", "Advanced options") as string}
      className="!max-w-4xl"
    >
      <div className="grid min-h-[420px] grid-cols-[200px_1fr] gap-5">
        {/* Left rail — settings list */}
        <nav
          aria-label={t("advancedOptions.navLabel", "Advanced settings") as string}
          className="flex flex-col gap-1 border-r border-subtle pr-4"
        >
          {SETTINGS.map((s) => {
            const active = s.id === selected;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                className={`rounded-sm px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider transition-colors ${
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-meta hover:bg-elevated hover:text-strong"
                }`}
              >
                {t(s.labelKey, s.fallback)}
              </button>
            );
          })}
        </nav>

        {/* Right pane — the selected setting's content */}
        <div className="min-w-0">
          {selected === "nyxid-service-binding" && (
            <NyxidServiceBindingPanel skill={skill} onClose={onClose} />
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// NyxidServiceBindingPanel — picker for the Bind-to-NyxID-Service setting
// ---------------------------------------------------------------------------

function NyxidServiceBindingPanel({
  skill,
  onClose,
}: {
  skill: SkillDetail;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: services = [], isLoading } = useMyNyxidServices();
  const mutation = useTieSkillToNyxidService(skill.guid);

  const [selectedId, setSelectedId] = useState<string | null>(skill.nyxidServiceId ?? null);
  useEffect(() => {
    setSelectedId(skill.nyxidServiceId ?? null);
  }, [skill.nyxidServiceId]);

  const adminServices = useMemo(
    () => services.filter((s) => s.tier === "admin"),
    [services],
  );
  const personalServices = useMemo(
    () => services.filter((s) => s.tier === "personal"),
    [services],
  );

  const selectedService = useMemo(
    () => services.find((s) => s.id === selectedId) ?? null,
    [services, selectedId],
  );
  const willForcePublic = selectedService?.tier === "admin" && skill.isPrivate;
  const bindingChanged = selectedId !== (skill.nyxidServiceId ?? null);

  const handleSave = async () => {
    if (!bindingChanged) {
      onClose();
      return;
    }
    try {
      await mutation.mutateAsync({ skillId: skill.guid, nyxidServiceId: selectedId });
      addToast({
        type: "success",
        message:
          selectedId === null
            ? (t("nyxidService.untieSuccess", "Service unbound") as string)
            : (t("nyxidService.tieSuccess", "Service bound") as string),
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: "error", message });
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <p className="font-body text-sm text-text-muted">
        {t(
          "nyxidService.intro",
          "Binding a skill to a NyxID admin service marks it as a system skill (forced public). Binding to one of your personal services leaves the privacy alone.",
        )}
      </p>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        <ServiceOption
          id={null}
          label={t("nyxidService.untied", "No binding (unbound)") as string}
          description={
            t(
              "nyxidService.untiedDesc",
              "This skill is not bound to any NyxID service. Privacy and sharing remain manually controlled.",
            ) as string
          }
          tier="none"
          selected={selectedId === null}
          onSelect={() => setSelectedId(null)}
        />

        {isLoading ? (
          <p className="font-body text-xs text-text-muted">
            {t("common.loading", "Loading...")}
          </p>
        ) : (
          <>
            {adminServices.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
                  {t("nyxidService.adminTier", "Admin services (system)")}
                </h4>
                <div className="space-y-2">
                  {adminServices.map((s) => (
                    <ServiceOption
                      key={s.id}
                      id={s.id}
                      label={s.label}
                      description={s.description ?? s.slug}
                      tier="admin"
                      selected={selectedId === s.id}
                      onSelect={() => setSelectedId(s.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {personalServices.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
                  {t("nyxidService.personalTier", "Personal services")}
                </h4>
                <div className="space-y-2">
                  {personalServices.map((s) => (
                    <ServiceOption
                      key={s.id}
                      id={s.id}
                      label={s.label}
                      description={s.description ?? s.slug}
                      tier="personal"
                      selected={selectedId === s.id}
                      onSelect={() => setSelectedId(s.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {adminServices.length === 0 && personalServices.length === 0 && (
              <p className="font-body text-xs text-text-muted italic">
                {t(
                  "nyxidService.noServices",
                  "No NyxID services available. Ask a platform admin or register one in NyxID.",
                )}
              </p>
            )}
          </>
        )}

        {willForcePublic && (
          <div className="rounded border border-warning/40 bg-warning-soft p-3 font-body text-xs text-warning">
            {t(
              "nyxidService.willForcePublic",
              "Binding to an admin service will force this skill to be public. Other share settings (users / orgs) are kept but ignored while the skill is public.",
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-subtle pt-3">
        <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button
          onClick={handleSave}
          loading={mutation.isPending}
          disabled={!bindingChanged}
        >
          {t("common.save", "Save")}
        </Button>
      </div>
    </div>
  );
}

interface ServiceOptionProps {
  id: string | null;
  label: string;
  description: string;
  tier: "admin" | "personal" | "none";
  selected: boolean;
  onSelect: () => void;
}

function ServiceOption({ label, description, tier, selected, onSelect }: ServiceOptionProps) {
  const tierBadge =
    tier === "admin" ? "⚙ system" : tier === "personal" ? "👤 personal" : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        selected
          ? "border-accent/60 bg-accent-soft"
          : "border-subtle bg-bg-elevated hover:border-accent/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading text-sm text-text-primary">{label}</span>
        {tierBadge && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
            {tierBadge}
          </span>
        )}
      </div>
      <p className="mt-0.5 font-body text-xs text-text-muted line-clamp-2">{description}</p>
    </button>
  );
}
