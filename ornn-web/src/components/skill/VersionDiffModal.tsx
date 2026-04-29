/**
 * VersionDiffModal — pick two published versions of a skill and render a
 * file-level diff between them.
 *
 * Hits `GET /api/v1/skills/:idOrName/versions/:from/diff/:to`. Server
 * inlines text content for both sides of every modified file (capped at
 * ~64 KiB per side; flag `truncated: true` when capped) so we can do
 * line-level diff client-side via the `diff` package without a second
 * round-trip. Binary files come back without inline content; we just
 * report the size + hash change.
 *
 * The default (`from`, `to`) lands as (currently-viewed version, latest)
 * so the common case — "what changed since the version I'm looking at" —
 * is one click away. The user can re-pick either side; same-version
 * compares are short-circuited locally (the backend would 400 with
 * `SAME_VERSION` and the round-trip is wasted).
 *
 * @module components/skill/VersionDiffModal
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { diffLines } from "diff";
import { Modal } from "@/components/ui/Modal";
import { useSkillVersionDiff } from "@/hooks/useSkills";
import type {
  DiffFileAdded,
  DiffFileModified,
  DiffFileRemoved,
  SkillVersionEntry,
} from "@/types/domain";

export interface VersionDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Skill id or name — passed straight to the diff endpoint. */
  idOrName: string;
  /** Full version list (already-fetched). Newest first. */
  versions: SkillVersionEntry[];
  /** Version the page is currently rendering — defaults the `from` picker. */
  currentVersion: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * Render a unified line-level diff for one modified text file. Uses the
 * `diff` package's `diffLines` to produce a sequence of chunks:
 * additions, deletions, and unchanged context. Each chunk's `value`
 * already includes trailing newlines, so we split on `\n` to render one
 * `<div>` per line and color the chunk accordingly.
 */
function ModifiedFileDiff({ file }: { file: DiffFileModified }) {
  const { t } = useTranslation();
  if (!file.isText || file.fromContent === undefined || file.toContent === undefined) {
    return (
      <p className="font-mono text-[11px] text-text-muted">
        {t("versionDiff.binaryHint", {
          defaultValue:
            "Binary file. {{from}} → {{to}} (hash {{fromHash}} → {{toHash}})",
          from: formatBytes(file.fromBytes),
          to: formatBytes(file.toBytes),
          fromHash: file.fromHash.slice(0, 8),
          toHash: file.toHash.slice(0, 8),
        })}
      </p>
    );
  }

  const chunks = diffLines(file.fromContent, file.toContent);
  return (
    <div className="overflow-x-auto rounded border border-subtle bg-page font-mono text-[11px] leading-snug">
      {chunks.map((chunk, idx) => {
        const lines = chunk.value.split("\n");
        // diffLines preserves a trailing empty token after the final newline;
        // drop it so we don't emit a blank line per chunk.
        if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        const sigil = chunk.added ? "+" : chunk.removed ? "-" : " ";
        const lineCls = chunk.added
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : chunk.removed
            ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
            : "text-text-muted";
        return (
          <div key={idx} className={lineCls}>
            {lines.map((line, lineIdx) => (
              <div key={lineIdx} className="px-3 py-px whitespace-pre-wrap break-all">
                <span className="select-none mr-2 text-text-muted/60">{sigil}</span>
                {line || " "}
              </div>
            ))}
          </div>
        );
      })}
      {file.truncated && (
        <p className="border-t border-subtle px-3 py-1.5 text-[11px] text-text-muted italic">
          {t("versionDiff.truncated", "File content truncated at 64 KiB per side.")}
        </p>
      )}
    </div>
  );
}

function FileHeader({
  path,
  meta,
  badge,
  badgeCls,
}: {
  path: string;
  meta?: string;
  badge: string;
  badgeCls: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-subtle pb-1.5">
      <div className="flex items-baseline gap-2 min-w-0">
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${badgeCls}`}
        >
          {badge}
        </span>
        <span className="truncate font-mono text-xs text-text-primary">{path}</span>
      </div>
      {meta && <span className="shrink-0 font-mono text-[10px] text-text-muted">{meta}</span>}
    </div>
  );
}

function AddedFile({ file }: { file: DiffFileAdded }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <FileHeader
        path={file.path}
        meta={formatBytes(file.bytes)}
        badge={t("versionDiff.added", "added")}
        badgeCls="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      />
      {file.isText && file.content !== undefined ? (
        <pre className="overflow-x-auto rounded border border-subtle bg-page p-3 font-mono text-[11px] leading-snug text-text-primary whitespace-pre-wrap break-all">
          {file.content}
        </pre>
      ) : (
        <p className="font-mono text-[11px] text-text-muted">
          {t("versionDiff.binaryAdded", {
            defaultValue: "Binary file ({{size}}).",
            size: formatBytes(file.bytes),
          })}
        </p>
      )}
    </div>
  );
}

function RemovedFile({ file }: { file: DiffFileRemoved }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <FileHeader
        path={file.path}
        meta={formatBytes(file.bytes)}
        badge={t("versionDiff.removed", "removed")}
        badgeCls="bg-rose-500/15 text-rose-700 dark:text-rose-300"
      />
      {file.isText && file.content !== undefined ? (
        <pre className="overflow-x-auto rounded border border-subtle bg-page p-3 font-mono text-[11px] leading-snug text-text-primary whitespace-pre-wrap break-all">
          {file.content}
        </pre>
      ) : (
        <p className="font-mono text-[11px] text-text-muted">
          {t("versionDiff.binaryRemoved", {
            defaultValue: "Binary file ({{size}}).",
            size: formatBytes(file.bytes),
          })}
        </p>
      )}
    </div>
  );
}

function ModifiedFile({ file }: { file: DiffFileModified }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <FileHeader
        path={file.path}
        meta={`${formatBytes(file.fromBytes)} → ${formatBytes(file.toBytes)}`}
        badge={t("versionDiff.modified", "modified")}
        badgeCls="bg-amber-500/15 text-amber-700 dark:text-amber-300"
      />
      <ModifiedFileDiff file={file} />
    </div>
  );
}

export function VersionDiffModal({
  isOpen,
  onClose,
  idOrName,
  versions,
  currentVersion,
}: VersionDiffModalProps) {
  const { t } = useTranslation();

  // Latest is the first row (versions are newest-first).
  const latestVersion = versions[0]?.version ?? "";

  // Default `from` = current; `to` = latest. If the user is already on
  // latest, default `from` to the second-newest so the picker isn't
  // pointing at the same row on both sides.
  const [fromVersion, setFromVersion] = useState<string>(() => {
    if (currentVersion && currentVersion !== latestVersion) return currentVersion;
    return versions[1]?.version ?? currentVersion ?? "";
  });
  const [toVersion, setToVersion] = useState<string>(latestVersion);

  // If the user reopens the modal after viewing a different version, snap
  // the defaults to the new `currentVersion`. Skipped while open so manual
  // picks aren't trampled mid-session.
  useEffect(() => {
    if (!isOpen) {
      const nextFrom =
        currentVersion && currentVersion !== latestVersion
          ? currentVersion
          : versions[1]?.version ?? currentVersion ?? "";
      setFromVersion(nextFrom);
      setToVersion(latestVersion);
    }
  }, [isOpen, currentVersion, latestVersion, versions]);

  const sameVersion = fromVersion && toVersion && fromVersion === toVersion;
  const enoughVersions = versions.length >= 2;

  const { data, isLoading, isFetching, error } = useSkillVersionDiff(
    idOrName,
    fromVersion,
    toVersion,
  );

  const summary = useMemo(() => {
    if (!data) return null;
    const f = data.diff.files;
    return {
      added: f.added.length,
      removed: f.removed.length,
      modified: f.modified.length,
      unchanged: f.unchangedCount,
    };
  }, [data]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("versionDiff.title", "Compare versions") as string}
      className="!max-w-4xl"
    >
      {!enoughVersions ? (
        <p className="font-body text-sm text-text-muted">
          {t(
            "versionDiff.needTwoVersions",
            "This skill only has one version — there's nothing to compare yet.",
          )}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block font-heading text-[10px] uppercase tracking-wider text-text-muted">
                {t("versionDiff.fromLabel", "From")}
              </span>
              <select
                value={fromVersion}
                onChange={(e) => setFromVersion(e.target.value)}
                className="
                  rounded border border-strong-edge bg-card px-2.5 py-1.5
                  font-mono text-sm text-text-primary
                  focus:outline-none focus:border-strong
                "
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}
                    {v.version === latestVersion ? ` (${t("skillDetail.latest")})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <span className="pb-2 font-mono text-text-muted" aria-hidden>
              →
            </span>

            <label className="space-y-1">
              <span className="block font-heading text-[10px] uppercase tracking-wider text-text-muted">
                {t("versionDiff.toLabel", "To")}
              </span>
              <select
                value={toVersion}
                onChange={(e) => setToVersion(e.target.value)}
                className="
                  rounded border border-strong-edge bg-card px-2.5 py-1.5
                  font-mono text-sm text-text-primary
                  focus:outline-none focus:border-strong
                "
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}
                    {v.version === latestVersion ? ` (${t("skillDetail.latest")})` : ""}
                  </option>
                ))}
              </select>
            </label>

            {summary && !sameVersion && (
              <p className="ml-auto pb-2 font-mono text-[11px] text-text-muted">
                {t("versionDiff.summary", {
                  defaultValue:
                    "{{added}} added · {{removed}} removed · {{modified}} modified · {{unchanged}} unchanged",
                  added: summary.added,
                  removed: summary.removed,
                  modified: summary.modified,
                  unchanged: summary.unchanged,
                })}
              </p>
            )}
          </div>

          {sameVersion && (
            <p className="font-body text-sm text-text-muted">
              {t(
                "versionDiff.sameVersion",
                "Pick two different versions to see a diff.",
              )}
            </p>
          )}

          {!sameVersion && (isLoading || isFetching) && !data && (
            <p className="font-body text-sm text-text-muted">
              {t("versionDiff.loading", "Computing diff…")}
            </p>
          )}

          {!sameVersion && error && (
            <p className="font-body text-sm text-danger">
              {error instanceof Error
                ? error.message
                : t("versionDiff.error", "Failed to compute diff.")}
            </p>
          )}

          {!sameVersion && data && summary && (
            <div className="space-y-6">
              {summary.added === 0 && summary.removed === 0 && summary.modified === 0 ? (
                <p className="font-body text-sm text-text-muted">
                  {t(
                    "versionDiff.noChanges",
                    "These two versions have identical files.",
                  )}
                </p>
              ) : (
                <>
                  {data.diff.files.modified.length > 0 && (
                    <section className="space-y-3">
                      <h3 className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
                        {t("versionDiff.modifiedHeading", {
                          defaultValue: "Modified ({{count}})",
                          count: data.diff.files.modified.length,
                        })}
                      </h3>
                      <div className="space-y-4">
                        {data.diff.files.modified.map((f) => (
                          <ModifiedFile key={f.path} file={f} />
                        ))}
                      </div>
                    </section>
                  )}
                  {data.diff.files.added.length > 0 && (
                    <section className="space-y-3">
                      <h3 className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
                        {t("versionDiff.addedHeading", {
                          defaultValue: "Added ({{count}})",
                          count: data.diff.files.added.length,
                        })}
                      </h3>
                      <div className="space-y-4">
                        {data.diff.files.added.map((f) => (
                          <AddedFile key={f.path} file={f} />
                        ))}
                      </div>
                    </section>
                  )}
                  {data.diff.files.removed.length > 0 && (
                    <section className="space-y-3">
                      <h3 className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
                        {t("versionDiff.removedHeading", {
                          defaultValue: "Removed ({{count}})",
                          count: data.diff.files.removed.length,
                        })}
                      </h3>
                      <div className="space-y-4">
                        {data.diff.files.removed.map((f) => (
                          <RemovedFile key={f.path} file={f} />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
