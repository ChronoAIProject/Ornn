/**
 * Card shown on `SkillDetailPage` for skills that are mirrored to the
 * configured GitHub mirror repo (`<owner>/<repo>`). Renders the
 * `npx skills add` install snippet with a click-to-copy button and a
 * compact sync-state chip.
 *
 * Hidden entirely when:
 *   - the mirror feature is disabled in this deployment,
 *   - the skill is private (private skills never mirror),
 *   - the GitHub repo config hasn't loaded yet (suspense without a
 *     Suspense boundary; just don't render until ready).
 *
 * @module components/skill/MirrorInstallCard
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { useGithubRepo } from "@/hooks/useGithubMirror";
import type { SkillDetail } from "@/types/domain";

interface MirrorInstallCardProps {
  skill: SkillDetail;
  className?: string;
}

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
        {t("mirrorInstallCard.neverSynced", "Never synced")}
      </span>
    );
  }
  const inSync = skill.mirrorSync.version === skill.version;
  if (inSync) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {t("mirrorInstallCard.synced", "Synced")} · v{skill.mirrorSync.version}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-warning">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
      {t("mirrorInstallCard.lagging", "Lagging")} · v{skill.mirrorSync.version} → v{skill.version}
    </span>
  );
}

export function MirrorInstallCard({ skill, className }: MirrorInstallCardProps) {
  const { t } = useTranslation();
  const { data: repoCfg } = useGithubRepo();
  const [copied, setCopied] = useState(false);

  // Hide on private skills (never mirrored), when feature is off, or when
  // we don't have repo coords yet.
  if (skill.isPrivate) return null;
  if (!repoCfg || !repoCfg.enabled) return null;
  if (!repoCfg.owner || !repoCfg.repo) return null;

  const slug = `${repoCfg.owner}/${repoCfg.repo}`;
  const command = `npx skills add ${slug}/${skill.name}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers.
      const ta = document.createElement("textarea");
      ta.value = command;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const commitUrl = skill.mirrorSync
    ? `https://github.com/${slug}/commit/${skill.mirrorSync.commitSha}`
    : null;
  const treeUrl = `https://github.com/${slug}/tree/${repoCfg.branch}/${encodeURIComponent(skill.name)}`;

  return (
    <Card className={`p-4 ${className ?? ""}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm uppercase tracking-[0.18em] text-strong">
            {t("mirrorInstallCard.title", "Install via npx")}
          </h3>
          <p className="mt-1 font-text text-xs text-meta">
            {t(
              "mirrorInstallCard.subtitle",
              "Mirrored to GitHub for one-line installation in any agent harness.",
            )}
          </p>
        </div>
        <SyncChip skill={skill} />
      </div>

      <div className="mt-3 flex items-stretch overflow-hidden rounded border border-strong-edge bg-elevated/40">
        <code className="flex-1 overflow-x-auto px-3 py-2 font-mono text-sm text-strong">
          {command}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={t("mirrorInstallCard.copyAria", "Copy install command")}
          className="flex shrink-0 items-center gap-1 border-l border-strong-edge px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-meta transition hover:bg-elevated hover:text-strong"
        >
          {copied ? (
            <>
              <CheckIcon className="h-3.5 w-3.5" />
              {t("mirrorInstallCard.copied", "Copied")}
            </>
          ) : (
            <>
              <CopyIcon className="h-3.5 w-3.5" />
              {t("mirrorInstallCard.copy", "Copy")}
            </>
          )}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-meta">
        <a
          href={treeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 transition hover:text-strong hover:underline"
        >
          {t("mirrorInstallCard.viewOnGithub", "View on GitHub")} →
        </a>
        {skill.mirrorSync ? (
          <>
            <span className="text-strong-edge">·</span>
            <span>
              {t("mirrorInstallCard.lastSync", "Last sync")} {relativeTime(skill.mirrorSync.syncedAt)}
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
                  {t("mirrorInstallCard.commit", "Commit")} {shortSha(skill.mirrorSync.commitSha)}
                </a>
              </>
            )}
          </>
        ) : (
          <>
            <span className="text-strong-edge">·</span>
            <span>
              {t(
                "mirrorInstallCard.pendingFirstSync",
                "Pending first sync — mirror commit usually lands within a few minutes.",
              )}
            </span>
          </>
        )}
      </div>
    </Card>
  );
}
