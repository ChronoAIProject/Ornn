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
import { VersionDiffView } from "@/components/skill/VersionDiffView";
import { useMyNyxidServices } from "@/hooks/useMe";
import {
  usePreviewSkillRefresh,
  useRefreshSkillFromSource,
  useSetSkillSource,
  useTieSkillToNyxidService,
} from "@/hooks/useSkills";
import { useToastStore } from "@/stores/toastStore";
import type { RefreshPreviewResponse } from "@/services/skillApi";
import type { SkillDetail } from "@/types/domain";

type AdvancedSettingId = "nyxid-service-binding" | "github-link";

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
  {
    id: "github-link",
    labelKey: "advancedOptions.githubLink",
    fallback: "Link to GitHub",
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
      className="!max-w-4xl !h-[80vh] !max-h-[80vh] !overflow-hidden flex flex-col"
    >
      {/*
        Fixed-height modal. The grid below grabs the remaining vertical
        space (flex-1 min-h-0) and gives both cells their own scroll
        container, so a long settings list on the left and a long
        settings panel on the right scroll independently — neither one
        forces the modal to grow.
      */}
      <div className="grid flex-1 min-h-0 grid-cols-[200px_1fr] gap-5">
        {/* Left rail — settings list */}
        <nav
          aria-label={t("advancedOptions.navLabel", "Advanced settings") as string}
          className="flex flex-col gap-1 overflow-y-auto border-r border-subtle pr-4"
        >
          {SETTINGS.map((s) => {
            const active = s.id === selected;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                className={`shrink-0 rounded-sm px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider transition-colors ${
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

        {/*
          Right pane — the selected setting's content. The panel itself
          owns its scroll via its own flex column (header / scrollable
          body / footer), so we just give it a min-h-0 flex column to
          fill and let the panel handle the inside.
        */}
        <div className="flex min-h-0 min-w-0 flex-col">
          {selected === "nyxid-service-binding" && (
            <NyxidServiceBindingPanel skill={skill} onClose={onClose} />
          )}
          {selected === "github-link" && (
            <GithubLinkPanel skill={skill} onClose={onClose} />
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
      <p className="font-text text-sm text-meta">
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
          <p className="font-text text-xs text-meta">
            {t("common.loading", "Loading...")}
          </p>
        ) : (
          <>
            {adminServices.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-mono text-[10px] uppercase tracking-widest text-meta">
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
                <h4 className="font-mono text-[10px] uppercase tracking-widest text-meta">
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
              <p className="font-text text-xs text-meta italic">
                {t(
                  "nyxidService.noServices",
                  "No NyxID services available. Ask a platform admin or register one in NyxID.",
                )}
              </p>
            )}
          </>
        )}

        {willForcePublic && (
          <div className="rounded border border-warning/40 bg-warning-soft p-3 font-text text-xs text-warning">
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

// ---------------------------------------------------------------------------
// GithubLinkPanel — attach / sync a GitHub source pointer
// ---------------------------------------------------------------------------

/**
 * Reconstruct a folder URL from a stored `source` pointer so the input
 * defaults to whatever was last saved. Mirrors the URL the user would
 * have typed in originally. Skills that have never been linked default
 * to the empty string.
 */
function urlFromSource(skill: SkillDetail): string {
  const src = skill.source;
  if (!src || src.type !== "github") return "";
  const ref = src.lastSyncedCommit || src.ref || "HEAD";
  const pathSuffix = src.path ? `/${src.path.replace(/^\/+/, "")}` : "";
  return `https://github.com/${src.repo}/tree/${ref}${pathSuffix}`;
}

function GithubLinkPanel({ skill, onClose }: { skill: SkillDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  const setSourceMutation = useSetSkillSource(skill.guid);
  const previewMutation = usePreviewSkillRefresh();
  const refreshMutation = useRefreshSkillFromSource(skill.guid);

  const initialUrl = useMemo(() => urlFromSource(skill), [skill]);
  const [url, setUrl] = useState(initialUrl);
  const [skipValidation, setSkipValidation] = useState(false);
  const [preview, setPreview] = useState<RefreshPreviewResponse | null>(null);

  // When the modal reopens (or the skill changes), reset to whatever the
  // server says is currently linked.
  useEffect(() => {
    setUrl(initialUrl);
    setPreview(null);
  }, [initialUrl]);

  const isLinked = !!(skill.source && skill.source.type === "github");
  const dirty = url.trim() !== initialUrl;

  const handleSave = async () => {
    try {
      const trimmed = url.trim();
      await setSourceMutation.mutateAsync({
        guid: skill.guid,
        githubUrl: trimmed === "" ? null : trimmed,
      });
      addToast({
        type: "success",
        message:
          trimmed === ""
            ? (t("githubLink.unlinkSuccess", "GitHub link removed") as string)
            : (t("githubLink.linkSuccess", "GitHub link saved") as string),
      });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleUnlink = async () => {
    try {
      await setSourceMutation.mutateAsync({ guid: skill.guid, githubUrl: null });
      setUrl("");
      setPreview(null);
      addToast({
        type: "success",
        message: t("githubLink.unlinkSuccess", "GitHub link removed") as string,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handlePreviewSync = async () => {
    try {
      const result = await previewMutation.mutateAsync(skill.guid);
      if (!result.hasChanges) {
        addToast({
          type: "success",
          message: t(
            "githubLink.alreadyInSync",
            "Already in sync — no changes to pull from GitHub.",
          ) as string,
        });
        return;
      }
      setPreview(result);
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleApplySync = async () => {
    try {
      await refreshMutation.mutateAsync({ guid: skill.guid, skipValidation });
      setPreview(null);
      addToast({
        type: "success",
        message: t(
          "githubLink.syncSuccess",
          "Synced from GitHub — new version published.",
        ) as string,
      });
      onClose();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const lastSyncedAt = skill.source?.lastSyncedAt;

  // ── Preview mode ─────────────────────────────────────────────────────
  if (preview) {
    return (
      <div className="flex h-full flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold text-strong">
              {t("githubLink.previewTitle", "Sync preview") as string}
            </h3>
            <p className="font-text text-xs text-meta">
              {t("githubLink.previewSubtitle", {
                defaultValue:
                  "Apply this sync to publish v{{version}} of {{name}} from the linked GitHub source.",
                version: preview.pendingVersion,
                name: preview.skill.name,
              })}
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          <VersionDiffView diff={preview.diff} showSummary />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-subtle pt-3">
          <label className="inline-flex items-center gap-2 font-text text-xs text-meta">
            <input
              type="checkbox"
              checked={skipValidation}
              onChange={(e) => setSkipValidation(e.target.checked)}
            />
            {t("githubLink.skipValidationLabel", "Skip Ornn package validation")}
          </label>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setPreview(null)}
              disabled={refreshMutation.isPending}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={handleApplySync} loading={refreshMutation.isPending}>
              {t("githubLink.applySync", "Apply sync")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Edit mode ────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      <p className="font-text text-sm text-meta">
        {t(
          "githubLink.intro",
          "Point this skill at a folder in a public GitHub repo. Saving the link does not pull anything; click Sync afterwards to preview changes and publish a new version.",
        )}
      </p>

      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        <div className="space-y-2">
          <label
            htmlFor="github-url"
            className="block font-display text-[10px] uppercase tracking-wider text-meta"
          >
            {t("githubLink.urlLabel", "GitHub folder URL")}
          </label>
          <input
            id="github-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/tree/main/path/to/skill"
            className="
              w-full rounded border border-strong-edge bg-card px-3 py-2
              font-mono text-sm text-strong
              focus:outline-none focus:border-strong
            "
          />
          <p className="font-text text-[11px] text-meta">
            {t(
              "githubLink.urlHelp",
              "Use the folder URL (the /tree/<ref>/<path> form). The skill's SKILL.md must be at the root of that folder. Default branch and repo-root URLs work too.",
            )}
          </p>
        </div>

        <label className="inline-flex items-start gap-2 font-text text-sm text-meta">
          <input
            type="checkbox"
            checked={skipValidation}
            onChange={(e) => setSkipValidation(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="block font-display text-xs text-strong">
              {t("githubLink.skipValidationLabel", "Skip Ornn package validation")}
            </span>
            <span className="block text-[11px]">
              {t(
                "githubLink.skipValidationHelp",
                "GitHub-hosted skills don't always follow Ornn's package rules; tick this if you trust the upstream and want syncs to succeed even when the validator would reject the layout.",
              )}
            </span>
          </span>
        </label>

        {isLinked && (
          <div className="rounded border border-subtle bg-elevated p-3">
            <p className="font-display text-[10px] uppercase tracking-wider text-meta">
              {t("githubLink.currentlyLinked", "Currently linked")}
            </p>
            <p className="mt-1 font-mono text-xs text-strong break-all">{initialUrl}</p>
            <p className="mt-1 font-text text-[11px] text-meta">
              {lastSyncedAt
                ? t("githubLink.lastSyncedAt", {
                    defaultValue: "Last synced {{when}}",
                    when: new Date(lastSyncedAt).toLocaleString(),
                  })
                : t("githubLink.neverSynced", "Linked but never synced.")}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-3">
        <div className="flex gap-2">
          {isLinked && (
            <span
              title={
                dirty
                  ? (t(
                      "githubLink.saveBeforeSync",
                      "Save the URL change first, then sync.",
                    ) as string)
                  : undefined
              }
            >
              <Button
                variant="secondary"
                onClick={handlePreviewSync}
                loading={previewMutation.isPending}
                disabled={dirty}
              >
                {t("githubLink.syncButton", "Sync from GitHub")}
              </Button>
            </span>
          )}
          {isLinked && (
            <Button
              variant="danger"
              onClick={handleUnlink}
              loading={setSourceMutation.isPending}
            >
              {t("githubLink.unlinkButton", "Unlink")}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={setSourceMutation.isPending}>
            {t("common.close", "Close")}
          </Button>
          <Button
            onClick={handleSave}
            loading={setSourceMutation.isPending}
            disabled={!dirty}
          >
            {t("common.save", "Save")}
          </Button>
        </div>
      </div>
    </div>
  );
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
          : "border-subtle bg-elevated hover:border-accent/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-sm text-strong">{label}</span>
        {tierBadge && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-meta">
            {tierBadge}
          </span>
        )}
      </div>
      <p className="mt-0.5 font-text text-xs text-meta line-clamp-2">{description}</p>
    </button>
  );
}
