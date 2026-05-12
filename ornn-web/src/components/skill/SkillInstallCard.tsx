/**
 * Card shown on `SkillDetailPage` for any skill the caller can try.
 * Two tabs:
 *
 *   - Via prompt  — copies the LLM-ready install prompt (`buildTrySkillPrompt`)
 *                   that a user pastes into their own agent. Works for any
 *                   skill the caller has access to.
 *   - Via npx     — copies `npx skills add <slug>/<name>` for installing from
 *                   the GitHub mirror. Gated by mirror-enabled + public skill;
 *                   renders an "unavailable" placeholder when those conditions
 *                   don't hold instead of hiding the whole tab.
 *
 * Hidden entirely when the caller is not authenticated, or for non-public
 * skills viewed by a non-owner — i.e. when the caller can't try the skill
 * at all (canTryWithCli is false). Otherwise the card always shows so the
 * prompt path is reachable for private-skill owners and for deployments
 * without the GitHub mirror configured.
 *
 * Replaces the older MirrorInstallCard + the "Install skill to my agent"
 * three-dots menu item (#411).
 *
 * @module components/skill/SkillInstallCard
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { useGithubRepo } from "@/hooks/useGithubMirror";
import { buildTrySkillPrompt } from "@/lib/buildTrySkillPrompt";
import type { SkillDetail } from "@/types/domain";

interface SkillInstallCardProps {
  skill: SkillDetail;
  className?: string;
}

type Tab = "prompt" | "npx";

/** Format an ISO timestamp as a relative phrase ("3 hours ago", "just now"). */
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)} min ago`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)} hr ago`;
  return `${Math.floor(deltaSec / 86_400)} day${Math.floor(deltaSec / 86_400) === 1 ? "" : "s"} ago`;
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" strokeWidth={1.5} />
      <path strokeWidth={1.5} d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

/**
 * Compact pill describing the sync relationship between this skill's
 * latest version on Ornn and what's currently on the GitHub mirror.
 */
function SyncChip({ skill }: { skill: SkillDetail }) {
  const { t } = useTranslation();
  if (!skill.mirrorSync) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-strong-edge bg-elevated/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        <span className="h-1.5 w-1.5 rounded-full bg-meta" />
        {t("skillInstallCard.neverSynced", "Never synced")}
      </span>
    );
  }
  const inSync = skill.mirrorSync.version === skill.version;
  if (inSync) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {t("skillInstallCard.synced", "Synced")} · v{skill.mirrorSync.version}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-warning">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
      {t("skillInstallCard.lagging", "Lagging")} · v{skill.mirrorSync.version} → v{skill.version}
    </span>
  );
}

/** Multi-line copy block with a sticky "Copy" button. */
function CopyBlock({
  content,
  copyAriaLabel,
  multiline,
}: {
  content: string;
  copyAriaLabel: string;
  multiline: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-stretch overflow-hidden rounded border border-strong-edge bg-elevated/40">
      <code
        className={
          multiline
            ? "flex-1 max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs text-strong"
            : "flex-1 overflow-x-auto px-3 py-2 font-mono text-sm text-strong"
        }
      >
        {content}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copyAriaLabel}
        className="flex shrink-0 items-center gap-1 self-start border-l border-strong-edge px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-meta transition hover:bg-elevated hover:text-strong"
      >
        {copied ? (
          <>
            <CheckIcon className="h-3.5 w-3.5" />
            {t("skillInstallCard.copied", "Copied")}
          </>
        ) : (
          <>
            <CopyIcon className="h-3.5 w-3.5" />
            {t("skillInstallCard.copy", "Copy")}
          </>
        )}
      </button>
    </div>
  );
}

export function SkillInstallCard({ skill, className }: SkillInstallCardProps) {
  const { t } = useTranslation();
  const { data: repoCfg } = useGithubRepo();
  const [tab, setTab] = useState<Tab>("prompt");

  // The prompt is universally available — works for any skill the caller
  // can see. Memoised so flipping tabs doesn't re-stringify on every render.
  const prompt = useMemo(
    () =>
      buildTrySkillPrompt({
        guid: skill.guid,
        name: skill.name,
        description: skill.description,
        metadata: skill.metadata ?? {},
        ornnOrigin: window.location.origin,
      }),
    [skill.guid, skill.name, skill.description, skill.metadata],
  );

  // The npx path needs all three of: mirror feature on, skill public,
  // and the configured GitHub repo coords loaded. Anything missing →
  // render a clear "unavailable" message in the npx tab so the user
  // understands why (instead of an empty box or hiding the tab).
  const npxAvailable =
    !skill.isPrivate && !!repoCfg && repoCfg.enabled && !!repoCfg.owner && !!repoCfg.repo;
  const slug = repoCfg && repoCfg.owner && repoCfg.repo ? `${repoCfg.owner}/${repoCfg.repo}` : null;
  const command = slug ? `npx skills add ${slug}/${skill.name}` : "";

  const commitUrl =
    npxAvailable && slug && skill.mirrorSync
      ? `https://github.com/${slug}/commit/${skill.mirrorSync.commitSha}`
      : null;
  const treeUrl =
    npxAvailable && slug && repoCfg
      ? `https://github.com/${slug}/tree/${repoCfg.branch}/${encodeURIComponent(skill.name)}`
      : null;

  return (
    <Card className={`p-4 ${className ?? ""}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm uppercase tracking-[0.18em] text-strong">
            {t("skillInstallCard.title", "Install")}
          </h3>
          <p className="mt-1 font-text text-xs text-meta">
            {t(
              "skillInstallCard.subtitle",
              "Drop this skill into your own agent with one of the two flows below.",
            )}
          </p>
        </div>
        {tab === "npx" && npxAvailable && <SyncChip skill={skill} />}
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label={t("skillInstallCard.tablistAria", "Install method")}
        className="mt-3 flex gap-1 border-b border-subtle"
      >
        <TabButton active={tab === "prompt"} onClick={() => setTab("prompt")}>
          {t("skillInstallCard.tabPrompt", "Via prompt")}
        </TabButton>
        <TabButton active={tab === "npx"} onClick={() => setTab("npx")}>
          {t("skillInstallCard.tabNpx", "Via npx")}
        </TabButton>
      </div>

      {tab === "prompt" && (
        <div role="tabpanel" className="mt-3 space-y-3">
          <p className="font-text text-xs text-meta">
            {t(
              "skillInstallCard.promptHelper",
              "Copy the block below and paste it into your agent — it instructs the agent to fetch and install this skill from Ornn.",
            )}
          </p>
          <CopyBlock
            content={prompt}
            copyAriaLabel={t("skillInstallCard.copyPromptAria", "Copy install prompt")}
            multiline
          />
        </div>
      )}

      {tab === "npx" && (
        <div role="tabpanel" className="mt-3 space-y-3">
          {npxAvailable ? (
            <>
              <p className="font-text text-xs text-meta">
                {t(
                  "skillInstallCard.npxHelper",
                  "Mirrored to GitHub for one-line installation in any agent harness.",
                )}
              </p>
              <CopyBlock
                content={command}
                copyAriaLabel={t("skillInstallCard.copyNpxAria", "Copy install command")}
                multiline={false}
              />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
                {treeUrl && (
                  <a
                    href={treeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-2 transition hover:text-strong hover:underline"
                  >
                    {t("skillInstallCard.viewOnGithub", "View on GitHub")} →
                  </a>
                )}
                {skill.mirrorSync ? (
                  <>
                    <span className="text-strong-edge">·</span>
                    <span>
                      {t("skillInstallCard.lastSync", "Last sync")}{" "}
                      {relativeTime(skill.mirrorSync.syncedAt)}
                    </span>
                    {commitUrl && (
                      <>
                        <span className="text-strong-edge">·</span>
                        <a
                          href={commitUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline-offset-2 transition hover:text-strong hover:underline"
                          title={skill.mirrorSync.commitSha}
                        >
                          {t("skillInstallCard.commit", "Commit")}{" "}
                          {shortSha(skill.mirrorSync.commitSha)}
                        </a>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-strong-edge">·</span>
                    <span>
                      {t(
                        "skillInstallCard.pendingFirstSync",
                        "Pending first sync — mirror commit usually lands within a few minutes.",
                      )}
                    </span>
                  </>
                )}
              </div>
            </>
          ) : (
            <p className="font-text text-xs text-meta">
              {skill.isPrivate
                ? t(
                    "skillInstallCard.npxNotAvailablePrivate",
                    "Not available — private skills are never mirrored to GitHub. Use the prompt flow instead.",
                  )
                : t(
                    "skillInstallCard.npxNotAvailableMirrorOff",
                    "Not available — this deployment doesn't have the GitHub mirror configured. Use the prompt flow instead.",
                  )}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? "border-b-2 border-accent px-3 py-1.5 font-mono text-xs uppercase tracking-[0.14em] text-strong"
          : "border-b-2 border-transparent px-3 py-1.5 font-mono text-xs uppercase tracking-[0.14em] text-meta transition hover:text-strong"
      }
    >
      {children}
    </button>
  );
}
