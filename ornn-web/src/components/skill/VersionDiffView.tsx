/**
 * VersionDiffView — pure renderer for a `VersionDiffResponse["diff"]`
 * payload. Knows how to draw the Modified / Added / Removed sections,
 * with a unified line-level diff for every modified text file via the
 * `diff` package.
 *
 * Used by `VersionDiffModal` (compare two existing versions) and by the
 * GitHub-link panel inside `AdvancedOptionsModal` (preview a pending
 * sync against the upstream repo). Pure: no fetching, no state — caller
 * passes the already-fetched `diff` object in.
 *
 * @module components/skill/VersionDiffView
 */

import { useTranslation } from "react-i18next";
import { diffLines } from "diff";
import type {
  DiffFileAdded,
  DiffFileModified,
  DiffFileRemoved,
  VersionDiffResponse,
} from "@/types/domain";

export interface VersionDiffViewProps {
  diff: VersionDiffResponse["diff"];
  /** Optional — render an "X added · Y removed · Z modified · W unchanged" summary line at the top. */
  showSummary?: boolean;
  /** Optional — placeholder when no changes are detected. Default reads `versionDiff.noChanges`. */
  emptyLabel?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

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
                {line || " "}
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

export function VersionDiffView({ diff, showSummary = false, emptyLabel }: VersionDiffViewProps) {
  const { t } = useTranslation();
  const f = diff.files;
  const isEmpty = f.added.length === 0 && f.removed.length === 0 && f.modified.length === 0;

  if (isEmpty) {
    return (
      <p className="font-body text-sm text-text-muted">
        {emptyLabel ??
          (t("versionDiff.noChanges", "These two versions have identical files.") as string)}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {showSummary && (
        <p className="font-mono text-[11px] text-text-muted">
          {t("versionDiff.summary", {
            defaultValue:
              "{{added}} added · {{removed}} removed · {{modified}} modified · {{unchanged}} unchanged",
            added: f.added.length,
            removed: f.removed.length,
            modified: f.modified.length,
            unchanged: f.unchangedCount,
          })}
        </p>
      )}
      {f.modified.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
            {t("versionDiff.modifiedHeading", {
              defaultValue: "Modified ({{count}})",
              count: f.modified.length,
            })}
          </h3>
          <div className="space-y-4">
            {f.modified.map((file) => (
              <ModifiedFile key={file.path} file={file} />
            ))}
          </div>
        </section>
      )}
      {f.added.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
            {t("versionDiff.addedHeading", {
              defaultValue: "Added ({{count}})",
              count: f.added.length,
            })}
          </h3>
          <div className="space-y-4">
            {f.added.map((file) => (
              <AddedFile key={file.path} file={file} />
            ))}
          </div>
        </section>
      )}
      {f.removed.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-heading text-[11px] uppercase tracking-wider text-text-muted">
            {t("versionDiff.removedHeading", {
              defaultValue: "Removed ({{count}})",
              count: f.removed.length,
            })}
          </h3>
          <div className="space-y-4">
            {f.removed.map((file) => (
              <RemovedFile key={file.path} file={file} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
