/**
 * Claude Code plugin install snippet for an exported skillset (#1155).
 *
 * Shown on the skillset detail page only when the skillset is actually
 * exportable + exported: the owner opted in (`exportAsPlugin`), every member
 * is public (`memberVisibilityState === "all-public"` — the only state the
 * mirror exports), and the GitHub mirror feature is enabled (so a repo exists
 * to install from). The repo coordinates come from the public
 * `GET /github/repo` endpoint via {@link useGithubRepo}, so nothing is
 * hardcoded — an admin re-point propagates here automatically.
 *
 * @module components/skillset/SkillsetPluginInstallCard
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RailCard } from "@/components/detail/RailCard";
import { useGithubRepo } from "@/hooks/useGithubMirror";
import type { SkillsetMemberVisibilityState } from "@/types/skillset";

export interface SkillsetPluginInstallCardProps {
  skillsetName: string;
  exportAsPlugin: boolean;
  memberVisibilityState: SkillsetMemberVisibilityState;
}

export function SkillsetPluginInstallCard({
  skillsetName,
  exportAsPlugin,
  memberVisibilityState,
}: SkillsetPluginInstallCardProps) {
  const { t } = useTranslation();
  const { data: repoCfg } = useGithubRepo();
  const [copied, setCopied] = useState(false);

  // Gate on the SAME conditions the mirror uses to actually export the plugin,
  // so the snippet never advertises an install that won't resolve.
  if (!exportAsPlugin || memberVisibilityState !== "all-public") return null;
  if (!repoCfg?.enabled || !repoCfg.owner || !repoCfg.repo) return null;

  const slug = `${repoCfg.owner}/${repoCfg.repo}`;
  const commands = `/plugin marketplace add ${slug}\n/plugin install ${skillsetName}@${repoCfg.repo}`;

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
    <RailCard title={t("skillsetDetail.pluginInstallTitle", "Install as a Claude Code plugin")}>
      <p className="mb-3 font-text text-sm text-meta">
        {t(
          "skillsetDetail.pluginInstallHint",
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
          aria-label={t("skillsetDetail.pluginInstallCopy", "Copy install commands")}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-sm border border-accent-muted bg-accent px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-page shadow-sm transition hover:bg-accent-muted"
        >
          {copied
            ? t("skillInstallCard.copied", "Copied")
            : t("skillInstallCard.copy", "Copy")}
        </button>
      </div>
      <p className="mt-3 font-text text-xs text-meta">
        {t(
          "skillsetDetail.pluginInstallAutoUpdate",
          "Third-party marketplaces default to auto-update OFF — enable it in /plugin → Marketplaces to receive updates.",
        )}
      </p>
    </RailCard>
  );
}
