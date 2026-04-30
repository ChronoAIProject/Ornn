/**
 * Chip on `SkillDetailPage` that flags "this skill was imported from GitHub"
 * and offers owner/admin a one-click refresh.
 *
 * Hidden entirely for skills without a `source` pointer.
 *
 * @module components/skill/GitHubOriginChip
 */

import { useTranslation } from "react-i18next";
import type { SkillSource } from "@/types/domain";

interface GitHubOriginChipProps {
  source: SkillSource | undefined;
  /** True when the caller may trigger `/refresh` (owner or platform admin). */
  canRefresh: boolean;
  /** External-loading flag from the refresh mutation. */
  isRefreshing: boolean;
  onRefresh: () => void;
  className?: string;
}

function GitHubMarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 00-3.64 22.42c.58.11.79-.25.79-.56v-2.16c-3.21.7-3.89-1.37-3.89-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.97.1-.76.4-1.27.73-1.56-2.56-.29-5.26-1.28-5.26-5.72 0-1.26.45-2.3 1.19-3.11-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18.92-.26 1.92-.39 2.9-.39.99 0 1.98.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.85 1.19 3.11 0 4.45-2.7 5.42-5.28 5.71.41.35.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0012 .5z" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4 4v6h6M20 20v-6h-6M20 10a8 8 0 10-2.34 5.66L20 14"
      />
    </svg>
  );
}

/** First 7 characters of a commit SHA; fall back to the raw input. */
function shortSha(sha: string | undefined): string | null {
  if (!sha) return null;
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

export function GitHubOriginChip({
  source,
  canRefresh,
  isRefreshing,
  onRefresh,
  className,
}: GitHubOriginChipProps) {
  const { t } = useTranslation();

  if (!source || source.type !== "github") return null;

  const sha = shortSha(source.lastSyncedCommit);
  const refLabel = source.ref || "HEAD";
  // Prefer the exact commit for deep-link stability; fall back to ref.
  const treeRef = source.lastSyncedCommit || source.ref || "HEAD";
  const pathSuffix = source.path ? `/${source.path.replace(/^\/+/, "")}` : "";
  const repoUrl = `https://github.com/${source.repo}/tree/${treeRef}${pathSuffix}`;

  const syncedAt = source.lastSyncedAt ? new Date(source.lastSyncedAt) : null;
  const syncedLabel =
    syncedAt && !Number.isNaN(syncedAt.getTime()) ? syncedAt.toLocaleString() : null;

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg border border-accent/20 bg-card/40 px-3 py-2 ${
        className ?? ""
      }`}
    >
      <GitHubMarkIcon className="h-4 w-4 text-strong" />
      <span className="font-display text-xs uppercase tracking-wider text-meta">
        {t("githubOrigin.label", "Synced from GitHub")}
      </span>
      <a
        href={repoUrl}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-sm text-accent transition-colors hover:text-strong"
        title={source.lastSyncedCommit || refLabel}
      >
        {source.repo}
        {sha ? <span className="text-meta">@{sha}</span> : null}
      </a>
      <span className="font-text text-xs text-meta">
        · {t("githubOrigin.ref", "ref")}:{" "}
        <span className="font-mono">{refLabel}</span>
        {source.path && (
          <>
            {" "}
            · {t("githubOrigin.path", "path")}:{" "}
            <span className="font-mono">{source.path}</span>
          </>
        )}
      </span>
      {syncedLabel && (
        <span className="font-text text-xs text-meta">
          · {t("githubOrigin.syncedAt", "synced")} {syncedLabel}
        </span>
      )}
      <div className="flex-1" />
      {canRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 px-3 py-1 font-text text-xs text-strong transition-colors hover:bg-accent/10 cursor-pointer disabled:opacity-50"
        >
          <RefreshIcon
            className={`h-3.5 w-3.5 text-meta ${isRefreshing ? "animate-spin" : ""}`}
          />
          {isRefreshing
            ? t("githubOrigin.refreshing", "Refreshing…")
            : t("githubOrigin.refresh", "Refresh from GitHub")}
        </button>
      )}
    </div>
  );
}
