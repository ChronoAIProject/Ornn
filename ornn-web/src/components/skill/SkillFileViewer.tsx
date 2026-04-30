/**
 * Skill File Viewer Component.
 *
 * "Naked" viewer — no outer rounded box, no outer border. The parent
 * (SkillFileBrowser / SkillPackagePreview) wraps this and the file
 * tree inside one unified panel so the two halves read as a single
 * letterpressed surface instead of two stacked cards.
 *
 * Renders:
 *   - thin header strip with the file path + (optional) edit toggle
 *   - mono-text content area, scrolls on overflow
 *   - binary files get a labeled placeholder
 *
 * @module components/skill/SkillFileViewer
 */

import { useState } from "react";
import { formatFileSize } from "@/utils/formatters";

export interface SkillFileViewerProps {
  /** File content as plaintext */
  content: string;
  /** File name (for display in header) */
  filename: string;
  /** Allow editing (textarea instead of pre) */
  editable?: boolean;
  /** Callback when content changes */
  onChange?: (content: string) => void;
  /** Whether the file is binary */
  isBinary?: boolean;
  /** File size in bytes (shown for binary files) */
  fileSize?: number;
  className?: string;
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  );
}

function PreviewIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function BinaryFileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

/** Header strip — shared by viewer and binary placeholder. */
function ViewerHeader({
  filename,
  trailing,
}: {
  filename: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-subtle bg-elevated/40 px-4 py-2">
      <span
        aria-hidden
        className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-meta"
      >
        FILE
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-sm text-strong">
        {filename}
      </span>
      {trailing}
    </div>
  );
}

export function SkillFileViewer({
  content,
  filename,
  editable = false,
  onChange,
  isBinary = false,
  fileSize,
  className = "",
}: SkillFileViewerProps) {
  const [isEditing, setIsEditing] = useState(false);

  if (isBinary) {
    return (
      <div className={`flex h-full min-w-0 flex-col ${className}`}>
        <ViewerHeader filename={filename} />
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
          <BinaryFileIcon className="mb-3 h-12 w-12 text-meta" />
          <p className="font-mono text-sm text-strong">{filename}</p>
          {fileSize !== undefined && (
            <p className="mt-1 font-text text-xs text-meta">
              {formatFileSize(fileSize)} (binary file)
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full min-w-0 flex-col ${className}`}>
      <ViewerHeader
        filename={filename}
        trailing={
          editable ? (
            <button
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
              className="cursor-pointer rounded-sm p-1 text-meta transition-colors hover:bg-elevated hover:text-accent"
              title={isEditing ? "Preview" : "Edit"}
            >
              {isEditing ? (
                <PreviewIcon className="h-4 w-4" />
              ) : (
                <EditIcon className="h-4 w-4" />
              )}
            </button>
          ) : undefined
        }
      />

      {editable && isEditing ? (
        <textarea
          value={content}
          onChange={(e) => onChange?.(e.target.value)}
          className="w-full flex-1 resize-none bg-transparent p-4 font-mono text-sm leading-relaxed text-strong outline-none"
          spellCheck={false}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-strong">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
