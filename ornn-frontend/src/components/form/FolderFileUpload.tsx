/**
 * Folder File Upload Component.
 * Upload files with target folder selection for skill packages.
 * Used in Guided Step 3 and Generative Mode review.
 * @module components/form/FolderFileUpload
 */

import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { UPLOADABLE_FOLDERS, type UploadableFolder } from "@/types/skillPackage";
import { formatFileSize } from "@/utils/formatters";

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

export function FolderFileUpload({
  files,
  onUpload,
  onRemove,
  className = "",
}: FolderFileUploadProps) {
  const [selectedFolder, setSelectedFolder] = useState<UploadableFolder>("scripts");
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    (file: File) => {
      onUpload(selectedFolder, file);
    },
    [selectedFolder, onUpload],
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
              onClick={() => setSelectedFolder(folder)}
              className={`
                px-4 py-2 rounded-lg font-mono text-sm transition-all cursor-pointer
                ${
                  selectedFolder === folder
                    ? "bg-neon-cyan/10 border border-neon-cyan/40 text-neon-cyan"
                    : "bg-bg-elevated border border-transparent text-text-muted hover:text-text-primary"
                }
              `}
            >
              {FOLDER_LABELS[folder]}
            </button>
          ))}
        </div>

        {/* Drop zone */}
        <motion.div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          whileHover={{ borderColor: "rgba(255, 107, 0, 0.5)" }}
          className={`
            flex-1 flex items-center justify-center rounded-lg border-2 border-dashed
            px-4 py-4 cursor-pointer transition-colors min-h-[60px]
            ${isDragging ? "border-neon-cyan bg-neon-cyan/5" : "border-neon-cyan/20 bg-bg-deep/50"}
          `}
        >
          <p className="font-body text-sm text-text-muted">
            Drop file here or click to browse
          </p>
        </motion.div>
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

      {/* File list grouped by folder */}
      <div className="space-y-4">
        {UPLOADABLE_FOLDERS.map((folder) => {
          const folderFiles = files.get(folder) ?? [];
          return (
            <div key={folder}>
              <p className="font-heading text-xs uppercase tracking-wider text-text-muted mb-2">
                {FOLDER_LABELS[folder]}
              </p>
              {folderFiles.length === 0 ? (
                <p className="font-body text-xs text-text-muted/50 pl-4">
                  (no files)
                </p>
              ) : (
                <div className="space-y-1">
                  {folderFiles.map((file, index) => (
                    <div
                      key={`${folder}-${file.name}-${index}`}
                      className="flex items-center justify-between p-2 pl-4 rounded-lg bg-bg-elevated border border-neon-cyan/10"
                    >
                      <span className="font-mono text-sm text-text-primary truncate flex-1">
                        {file.name}
                      </span>
                      <span className="font-body text-xs text-text-muted mx-3 shrink-0">
                        {formatFileSize(file.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemove(folder, index)}
                        className="text-text-muted hover:text-neon-red transition-colors text-xs cursor-pointer shrink-0"
                      >
                        Remove
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
