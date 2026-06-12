/**
 * Folder File Upload Component.
 * Upload files with target folder selection for skill packages.
 * Used in Guided Step 3 and Generative Mode review.
 *
 * #655 — the upload accepted any file regardless of name or size:
 * duplicates in the same target folder stacked silently and a 55 MB
 * file went through without a warning. Added two guards inside
 * `handleFileSelect`, so both the click and drop paths are covered:
 *
 *   1. Duplicate filename inside the same target folder is rejected
 *      with an inline `<name> already exists in <folder>/` error. The
 *      user picks Remove on the existing chip if they really want to
 *      replace it — auto-overwrite would silently drop unsaved
 *      content.
 *   2. Per-file size cap of 10 MiB. The backend / ZIP pipeline caps
 *      total uncompressed at ~100 MB (#443 / #633); per-file 10 MiB
 *      keeps a single oversize artifact from eating the whole budget
 *      and signals the limit before the user assembles a doomed
 *      package.
 *
 * Both errors render under the drop zone with `aria-live="polite"`,
 * auto-clear on the next successful upload, and explicitly do NOT
 * call `onUpload` — the parent state stays untouched on rejection so
 * there's nothing for the user to undo.
 *
 * @module components/form/FolderFileUpload
 */

import { useState, useRef, useCallback } from "react";
import { UPLOADABLE_FOLDERS, type UploadableFolder } from "@/types/skillPackage";
import { formatFileSize } from "@/utils/formatters";
import { useTranslation } from "react-i18next";

export interface FolderFileUploadProps {
  /** Map of folder -> files */
  files: Map<UploadableFolder, File[]>;
  /** Callback when a file is uploaded to a folder */
  onUpload: (folder: UploadableFolder, file: File) => void;
  /** Callback when a file is removed */
  onRemove: (folder: UploadableFolder, index: number) => void;
  className?: string;
}

/** Folder display labels */
const FOLDER_LABELS: Record<UploadableFolder, string> = {
  scripts: "scripts/",
  references: "references/",
  assets: "assets/",
};

/**
 * Per-file size cap (#655). 10 MiB. Backend caps total uncompressed at
 * ~100 MB; per-file 10 MiB keeps a single oversize artifact from
 * eating the whole package budget and signals the limit early.
 */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export function FolderFileUpload({
  files,
  onUpload,
  onRemove,
  className = "",
}: FolderFileUploadProps) {
  const { t } = useTranslation();
  const [selectedFolder, setSelectedFolder] = useState<UploadableFolder>("scripts");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    (file: File) => {
      // #655 guard 1 — size cap. Reject before the parent ever sees
      // the file, so its package-state stays clean.
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setUploadError(
          t("guided.fileTooLarge", {
            name: file.name,
            size: formatFileSize(file.size),
            max: formatFileSize(MAX_FILE_SIZE_BYTES),
          }),
        );
        return;
      }
      // #655 guard 2 — duplicate filename inside the SAME target
      // folder. Cross-folder duplicates are fine (a `README.md` can
      // live in references/ even if scripts/ has one too — they
      // become different paths in the final ZIP).
      const existing = files.get(selectedFolder) ?? [];
      if (existing.some((f) => f.name === file.name)) {
        setUploadError(
          t("guided.fileDuplicate", {
            name: file.name,
            folder: FOLDER_LABELS[selectedFolder],
          }),
        );
        return;
      }
      setUploadError(null);
      onUpload(selectedFolder, file);
    },
    [selectedFolder, onUpload, files, t],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Folder selector + drop zone row */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Folder selector */}
        <div className="flex gap-1">
          {UPLOADABLE_FOLDERS.map((folder) => (
            <button
              key={folder}
              type="button"
              onClick={() => {
                setSelectedFolder(folder);
                // Folder switch is a fresh context — drop any stale
                // error from a previous folder's reject.
                setUploadError(null);
              }}
              className={`
                px-4 py-2 rounded font-mono text-sm transition-all cursor-pointer
                ${
                  selectedFolder === folder
                    ? "bg-accent/10 border border-accent/40 text-accent"
                    : "bg-elevated border border-transparent text-meta hover:text-strong"
                }
              `}
            >
              {FOLDER_LABELS[folder]}
            </button>
          ))}
        </div>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          className={`
            flex-1 flex items-center justify-center rounded border-2 border-dashed
            px-4 py-4 cursor-pointer transition-colors min-h-[60px]
            ${isDragging ? "border-accent bg-accent/5" : "border-accent/20 bg-page/50 hover:border-accent/50"}
          `}
        >
          <p className="font-text text-sm text-meta">
            {t("guided.dropHint")}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {/* Inline upload error — reserved for the live transient
          reject. Cleared on the next successful upload or folder
          switch. */}
      {uploadError && (
        <p
          className="font-text text-xs text-danger"
          aria-live="polite"
          role="alert"
        >
          {uploadError}
        </p>
      )}

      {/* Per-file size hint — always visible so users know the cap
          before they pick the file. */}
      <p className="font-text text-[11px] text-meta/60">
        {t("guided.fileSizeHint", { max: formatFileSize(MAX_FILE_SIZE_BYTES) })}
      </p>

      {/* File list grouped by folder */}
      <div className="space-y-4">
        {UPLOADABLE_FOLDERS.map((folder) => {
          const folderFiles = files.get(folder) ?? [];
          return (
            <div key={folder}>
              <p className="font-display text-xs uppercase tracking-wider text-meta mb-2">
                {FOLDER_LABELS[folder]}
              </p>
              {folderFiles.length === 0 ? (
                <p className="font-text text-xs text-meta/50 pl-4">
                  {t("guided.noFiles")}
                </p>
              ) : (
                <div className="space-y-1">
                  {folderFiles.map((file, index) => (
                    <div
                      key={`${folder}-${file.name}-${index}`}
                      className="flex items-center justify-between p-2 pl-4 rounded bg-elevated border border-accent/10"
                    >
                      <span className="font-mono text-sm text-strong truncate flex-1">
                        {file.name}
                      </span>
                      <span className="font-text text-xs text-meta mx-3 shrink-0">
                        {formatFileSize(file.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemove(folder, index)}
                        className="text-meta hover:text-danger transition-colors text-xs cursor-pointer shrink-0"
                      >
                        {t("guided.remove")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
