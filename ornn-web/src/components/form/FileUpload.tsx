import { useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { formatFileSize } from "@/utils/formatters";
import { MAX_FILE_SIZE_LABEL, MAX_FILE_SIZE_BYTES, ACCEPTED_FILE_TYPES } from "@/utils/constants";

interface FileUploadState {
  file: File | null;
  error: string | null;
  isDragging: boolean;
}

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File exceeds 50 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
  }
  const name = file.name.toLowerCase();
  const isValid = ACCEPTED_FILE_TYPES.some((ext) => name.endsWith(ext));
  if (!isValid) {
    return "Only .tar.gz and .zip files are accepted";
  }
  return null;
}

function useFileUpload() {
  const [state, setState] = useState<FileUploadState>({
    file: null,
    error: null,
    isDragging: false,
  });

  const handleFile = useCallback((file: File) => {
    const error = validateFile(file);
    setState({ file: error ? null : file, error, isDragging: false });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setState((prev) => ({ ...prev, isDragging: true }));
  }, []);

  const handleDragLeave = useCallback(() => {
    setState((prev) => ({ ...prev, isDragging: false }));
  }, []);

  const clearFile = useCallback(() => {
    setState({ file: null, error: null, isDragging: false });
  }, []);

  return { ...state, handleFile, handleDrop, handleDragOver, handleDragLeave, clearFile };
}

export interface FileUploadProps {
  onFileSelect: (file: File) => void;
  error?: string;
  className?: string;
}

export function FileUpload({ onFileSelect, error: externalError, className = "" }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { file, error, isDragging, handleFile, handleDrop, handleDragOver, handleDragLeave, clearFile } =
    useFileUpload();

  const handleFileChange = (f: File) => {
    handleFile(f);
    onFileSelect(f);
  };

  const displayError = externalError ?? error;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="font-heading text-xs uppercase tracking-wider text-text-muted">
        Package File
      </label>
      <motion.div
        onDrop={(e) => {
          handleDrop(e as unknown as React.DragEvent);
          const droppedFile = (e as unknown as React.DragEvent).dataTransfer?.files[0];
          if (droppedFile) onFileSelect(droppedFile);
        }}
        onDragOver={(e) => handleDragOver(e as unknown as React.DragEvent)}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        whileHover={{ borderColor: "rgba(255, 107, 0, 0.5)" }}
        className={`
          flex cursor-pointer flex-col items-center justify-center rounded-xl
          border-2 border-dashed px-6 py-10 transition-colors
          ${isDragging ? "border-neon-cyan bg-neon-cyan/5" : "border-neon-cyan/20 bg-bg-deep/50"}
        `}
      >
        {file ? (
          <div className="text-center">
            <p className="font-mono text-sm text-neon-cyan">{file.name}</p>
            <p className="mt-1 text-xs text-text-muted">{formatFileSize(file.size)}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearFile();
              }}
              className="mt-2 text-xs text-neon-red hover:underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="text-center">
            <p className="font-body text-sm text-text-muted">
              Drag & drop or click to browse
            </p>
            <p className="mt-1 text-xs text-text-muted/60">
              {ACCEPTED_FILE_TYPES.join(", ")} up to {MAX_FILE_SIZE_LABEL}
            </p>
          </div>
        )}
      </motion.div>
      <input
        ref={inputRef}
        type="file"
        accept=".tar.gz,.zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileChange(f);
        }}
        className="hidden"
      />
      {displayError && <span className="text-xs text-neon-red">{displayError}</span>}
    </div>
  );
}
