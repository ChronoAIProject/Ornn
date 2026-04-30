/**
 * Skill File Viewer Component.
 * Displays plaintext file content with optional edit mode.
 * Used within SkillPackagePreview for viewing/editing files.
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

/** Edit/pencil icon */
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

/** Eye/preview icon */
function PreviewIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

/** File icon for binary files */
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
      <div className={`flex flex-col rounded border border-accent/10 bg-page ${className}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-accent/10 bg-card px-4 py-2">
          <span className="font-mono text-sm text-strong truncate">
            {filename}
          </span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center py-16 px-4">
          <BinaryFileIcon className="h-12 w-12 text-meta mb-3" />
          <p className="font-mono text-sm text-strong">{filename}</p>
          {fileSize !== undefined && (
            <p className="font-text text-xs text-meta mt-1">
              {formatFileSize(fileSize)} (binary file)
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col rounded border border-accent/10 bg-page ${className}`}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-accent/10 bg-card px-4 py-2">
        <span className="font-mono text-sm text-strong truncate">
          {filename}
        </span>
        {editable && (
          <button
            type="button"
            onClick={() => setIsEditing((prev) => !prev)}
            className="p-1 rounded text-meta hover:text-accent transition-colors cursor-pointer"
            title={isEditing ? "Preview" : "Edit"}
          >
            {isEditing ? (
              <PreviewIcon className="h-4 w-4" />
            ) : (
              <EditIcon className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Content */}
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
