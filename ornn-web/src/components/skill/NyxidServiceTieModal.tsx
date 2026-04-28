/**
 * NyxidServiceTieModal — picker for tying a skill to a NyxID catalog
 * service.
 *
 * Two tiers:
 *   - **admin**    services (NyxID `visibility: "public"`, platform-wide).
 *     Tying here marks the skill a "system skill" and forces
 *     `isPrivate: false`.
 *   - **personal** services (caller-owned, NyxID `visibility: "private"`).
 *     Tying here doesn't change the skill's privacy.
 *
 * The picker also supports the "untie" path, which clears the tie and
 * leaves privacy alone.
 *
 * @module components/skill/NyxidServiceTieModal
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useMyNyxidServices } from "@/hooks/useMe";
import { useTieSkillToNyxidService } from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import type { SkillDetail } from "@/types/domain";

interface NyxidServiceTieModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: SkillDetail;
}

export function NyxidServiceTieModal({ isOpen, onClose, skill }: NyxidServiceTieModalProps) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: services = [], isLoading } = useMyNyxidServices();
  const mutation = useTieSkillToNyxidService(skill.guid);

  const [selectedId, setSelectedId] = useState<string | null>(skill.nyxidServiceId ?? null);

  useEffect(() => {
    if (isOpen) setSelectedId(skill.nyxidServiceId ?? null);
  }, [isOpen, skill.nyxidServiceId]);

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
  const willForcePublic =
    selectedService?.tier === "admin" && skill.isPrivate;

  const tieChanged = selectedId !== (skill.nyxidServiceId ?? null);

  const handleSave = async () => {
    if (!tieChanged) {
      onClose();
      return;
    }
    try {
      await mutation.mutateAsync({ skillId: skill.guid, nyxidServiceId: selectedId });
      addToast({
        type: "success",
        message:
          selectedId === null
            ? (t("nyxidService.untieSuccess", "Service unlinked") as string)
            : (t("nyxidService.tieSuccess", "Service linked") as string),
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: "error", message });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("nyxidService.modalTitle", "Tie to NyxID service") as string}
      className="!max-w-2xl"
    >
      <div className="space-y-4">
        <p className="font-body text-sm text-text-muted">
          {t(
            "nyxidService.intro",
            "Tying a skill to a NyxID admin service marks it as a system skill (forced public). Tying to one of your personal services leaves the privacy alone.",
          )}
        </p>

        <div className="space-y-3">
          <ServiceOption
            id={null}
            label={t("nyxidService.untied", "Untied (no service tie)") as string}
            description={
              t(
                "nyxidService.untiedDesc",
                "This skill is not associated with any NyxID service. Privacy and sharing remain manually controlled.",
              ) as string
            }
            tier="none"
            selected={selectedId === null}
            onSelect={() => setSelectedId(null)}
          />
        </div>

        {isLoading ? (
          <p className="font-body text-xs text-text-muted">{t("common.loading", "Loading...")}</p>
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
              "Tying to an admin service will force this skill to be public. Other share settings (users / orgs) are kept but ignored while the skill is public.",
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4 mt-5 border-t border-neon-cyan/10">
        <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button onClick={handleSave} loading={mutation.isPending} disabled={!tieChanged}>
          {t("common.save", "Save")}
        </Button>
      </div>
    </Modal>
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
