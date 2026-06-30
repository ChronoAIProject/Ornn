/**
 * SkillsetPluginExportCard — owner-driven Claude Code plugin export (#1157).
 *
 * Replaces the create/edit-form checkbox (#1155) with a deliberate, configurable
 * action on the skillset detail page, sitting directly above the visibility card.
 *
 *   - Owner, not exported: an "Export as a Claude Code plugin" button (disabled
 *     with a hint when the skillset isn't all-public) opens a confirm modal that
 *     lets the owner customise the plugin's display name / description / keywords.
 *   - Owner, exported: the install snippet + "Edit fields" (reopens the modal,
 *     prefilled) + "Stop exporting" (behind a small confirm).
 *   - Any viewer, exported: the install snippet only — an exported skillset is
 *     public, so the snippet is safe to surface to everyone.
 *
 * The install NAME stays the skillset name and the VERSION stays the auto
 * fingerprint — neither is user-editable. Export still requires every member be
 * public; the API enforces the same gate server-side.
 *
 * @module components/skillset/SkillsetPluginExportCard
 */

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { RailCard } from "@/components/detail/RailCard";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useGithubRepo } from "@/hooks/useGithubMirror";
import { useUpdatePluginExport } from "@/hooks/useSkillsets";
import { useToastStore } from "@/stores/toastStore";
import { translateError } from "@/utils/translateError";
import type { PluginExportInput, SkillsetDetail } from "@/types/skillset";

/** Kebab-case keyword — mirrors the backend `keywords` grammar. */
const KEYWORD_REGEX = /^[a-z0-9-]+$/;

export interface SkillsetPluginExportCardProps {
  skillset: SkillsetDetail;
  isOwner: boolean;
  /** URL id (name OR guid) the detail page was opened with — the cache key. */
  idOrName: string;
}

export function SkillsetPluginExportCard({
  skillset,
  isOwner,
  idOrName,
}: SkillsetPluginExportCardProps) {
  const { t } = useTranslation();
  const { data: repoCfg } = useGithubRepo();
  const addToast = useToastStore((s) => s.addToast);
  const mutation = useUpdatePluginExport(skillset.guid, idOrName);

  const [modalOpen, setModalOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);

  // Confirm-modal fields — prefilled from the existing overrides or the
  // skillset's own fields when opened (see openModal).
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const keywordInputId = useId();

  const allPublic = skillset.memberVisibilityState === "all-public";
  // The skillset is actually exporting only when opted in AND every member is
  // public (the only state the mirror publishes). A later member-privacy flip
  // can leave the opt-in set while export is effectively paused.
  const exported = skillset.exportAsPlugin && allPublic;

  const repoReady = !!repoCfg?.enabled && !!repoCfg.owner && !!repoCfg.repo;
  const commands = repoReady
    ? `/plugin marketplace add ${repoCfg!.owner}/${repoCfg!.repo}\n/plugin install ${skillset.name}@${repoCfg!.repo}`
    : "";

  function openModal() {
    setDisplayName(skillset.pluginConfig?.displayName ?? skillset.name);
    setDescription(skillset.pluginConfig?.description ?? skillset.description);
    setKeywords(skillset.pluginConfig?.keywords ?? skillset.tags);
    setModalOpen(true);
  }

  function addKeyword(raw: string) {
    const kw = raw.trim().toLowerCase();
    if (!kw || keywords.includes(kw) || !KEYWORD_REGEX.test(kw) || keywords.length >= 20) return;
    setKeywords([...keywords, kw]);
  }

  function removeKeyword(kw: string) {
    setKeywords(keywords.filter((x) => x !== kw));
  }

  async function handleConfirmExport() {
    const payload: PluginExportInput = { enabled: true };
    const dn = displayName.trim();
    const desc = description.trim();
    if (dn) payload.displayName = dn;
    if (desc) payload.description = desc;
    if (keywords.length > 0) payload.keywords = keywords;
    try {
      await mutation.mutateAsync(payload);
      addToast({
        type: "success",
        message: t("skillsetPluginExport.exportSuccess", "Plugin export enabled"),
      });
      setModalOpen(false);
    } catch (err) {
      addToast({ type: "error", message: translateError(err) });
    }
  }

  async function handleStopExport() {
    try {
      await mutation.mutateAsync({ enabled: false });
      addToast({
        type: "success",
        message: t("skillsetPluginExport.stopSuccess", "Plugin export stopped"),
      });
      setStopOpen(false);
    } catch (err) {
      addToast({ type: "error", message: translateError(err) });
    }
  }

  // Non-owner: only ever sees the install snippet, and only while exporting.
  if (!isOwner) {
    if (!exported || !repoReady) return null;
    return (
      <RailCard title={t("skillsetPluginExport.installTitle", "Install as a Claude Code plugin")}>
        <InstallSnippet commands={commands} />
      </RailCard>
    );
  }

  return (
    <RailCard
      title={t("skillsetPluginExport.cardTitle", "Claude Code plugin")}
      icon={
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      }
    >
      {skillset.exportAsPlugin ? (
        <div className="flex flex-col gap-3">
          <p className="font-text text-sm text-strong">
            {t("skillsetPluginExport.exportedStatus", "Exported as a Claude Code plugin")}
          </p>
          {exported && repoReady ? (
            <InstallSnippet commands={commands} />
          ) : (
            <p className="font-text text-xs text-meta">
              {t(
                "skillsetPluginExport.pausedNote",
                "Export is paused until every member skill is public again.",
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={openModal}>
              {t("skillsetPluginExport.editFields", "Edit fields")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setStopOpen(true)}>
              {t("skillsetPluginExport.stopExporting", "Stop exporting")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-text text-sm text-meta">
            {t(
              "skillsetPluginExport.intro",
              "Publish this skillset as one curated multi-skill plugin in the public mirror.",
            )}
          </p>
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            disabled={!allPublic}
            onClick={openModal}
          >
            {t("skillsetPluginExport.exportButton", "Export as a Claude Code plugin")}
          </Button>
          {!allPublic && (
            <p className="font-text text-xs text-meta">
              {t(
                "skillsetPluginExport.disabledHint",
                "Only available once every member skill is public.",
              )}
            </p>
          )}
        </div>
      )}

      {/* Confirm / edit modal — customise the plugin's listing fields. */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t("skillsetPluginExport.modalTitle", "Export as a Claude Code plugin")}
      >
        <p className="mb-4 font-text text-sm text-meta">
          {t(
            "skillsetPluginExport.modalIntro",
            "Customise how this plugin appears in the Claude Code marketplace. Each field defaults to the skillset's own value.",
          )}
        </p>
        <div className="flex flex-col gap-4">
          <Input
            label={t("skillsetPluginExport.displayNameLabel", "Display name") as string}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={skillset.name}
          />
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta">
              {t("skillsetPluginExport.descriptionLabel", "Description")}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1024}
              className="rounded-sm border border-subtle bg-elevated/40 px-3 py-2 font-text text-sm text-strong placeholder:text-meta/70 focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={keywordInputId}
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-meta"
            >
              {t("skillsetPluginExport.keywordsLabel", "Keywords")}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {keywords.map((kw) => (
                <button
                  key={kw}
                  type="button"
                  onClick={() => removeKeyword(kw)}
                  aria-label={`Remove ${kw}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-accent/60 bg-accent/15 px-2.5 py-1 font-text text-xs text-accent cursor-pointer"
                >
                  <span className="max-w-[140px] truncate">{kw}</span>
                  <span aria-hidden>×</span>
                </button>
              ))}
              <input
                id={keywordInputId}
                type="text"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addKeyword((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = "";
                  }
                }}
                placeholder={t("skillsetPluginExport.keywordsPlaceholder", "add keyword…") as string}
                className="w-32 rounded-sm border border-subtle bg-elevated/40 px-2 py-1.5 font-text text-xs text-strong placeholder:text-meta/70 focus:border-accent focus:outline-none"
              />
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={mutation.isPending}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={handleConfirmExport} loading={mutation.isPending}>
            {t("skillsetPluginExport.confirm", "Export")}
          </Button>
        </div>
      </Modal>

      {/* Stop-exporting confirmation. */}
      <ConfirmDialog
        isOpen={stopOpen}
        onClose={() => setStopOpen(false)}
        onConfirm={handleStopExport}
        title={t("skillsetPluginExport.stopConfirmTitle", "Stop exporting this plugin?")}
        description={t(
          "skillsetPluginExport.stopConfirmBody",
          "It will be removed from the Claude Code marketplace on the next sync.",
        )}
        confirmLabel={t("skillsetPluginExport.stopExporting", "Stop exporting")}
        isLoading={mutation.isPending}
      />
    </RailCard>
  );
}

/** The marketplace-add + install command block with a copy button. */
function InstallSnippet({ commands }: { commands: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(commands);
    } catch {
      // Clipboard may be unavailable (insecure context / denied permission);
      // the commands are still visible for manual copy.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <p className="mb-3 font-text text-sm text-meta">
        {t(
          "skillsetPluginExport.installHint",
          "Published as a curated multi-skill plugin. Install it in Claude Code:",
        )}
      </p>
      <div className="relative overflow-hidden rounded border border-strong-edge bg-elevated/40">
        <code className="block overflow-x-auto whitespace-pre px-3 py-2 pr-20 font-mono text-xs leading-relaxed text-strong">
          {commands}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={t("skillsetPluginExport.installCopy", "Copy install commands")}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-sm border border-accent-muted bg-accent px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-page shadow-sm transition hover:bg-accent-muted"
        >
          {copied
            ? t("skillInstallCard.copied", "Copied")
            : t("skillInstallCard.copy", "Copy")}
        </button>
      </div>
      <p className="mt-3 font-text text-xs text-meta">
        {t(
          "skillsetPluginExport.installAutoUpdate",
          "Third-party marketplaces default to auto-update OFF — enable it in /plugin → Marketplaces to receive updates.",
        )}
      </p>
    </div>
  );
}
