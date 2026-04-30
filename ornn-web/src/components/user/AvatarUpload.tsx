/**
 * Avatar Upload Component.
 * Allows users to upload and preview avatar images.
 * @module components/user/AvatarUpload
 */

import { useRef, useState } from "react";
import { motion } from "framer-motion";

export interface AvatarUploadProps {
  /** Current avatar URL. */
  currentUrl: string | null;
  /** Called when avatar is uploaded. */
  onUpload: (url: string | null) => void;
  /** Called when avatar file is selected (for actual upload). */
  onFileSelect?: (file: File) => Promise<string>;
  /** Disable upload. */
  disabled?: boolean;
  /** Size of the avatar. */
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASSES = {
  sm: "h-16 w-16",
  md: "h-24 w-24",
  lg: "h-32 w-32",
} as const;

const ICON_SIZES = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-10 w-10",
} as const;

export function AvatarUpload({
  currentUrl,
  onUpload,
  onFileSelect,
  disabled = false,
  size = "lg",
}: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);

  const handleClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return;
    }

    // Create preview URL
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    // If onFileSelect is provided, upload the file
    if (onFileSelect) {
      setIsLoading(true);
      try {
        const uploadedUrl = await onFileSelect(file);
        onUpload(uploadedUrl);
        // Clean up object URL
        URL.revokeObjectURL(objectUrl);
        setPreviewUrl(uploadedUrl);
      } catch {
        // Revert preview on error
        setPreviewUrl(currentUrl);
        URL.revokeObjectURL(objectUrl);
      } finally {
        setIsLoading(false);
      }
    } else {
      // Just use local preview
      onUpload(objectUrl);
    }

    // Reset input
    e.target.value = "";
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewUrl(null);
    onUpload(null);
  };

  const displayUrl = previewUrl || currentUrl;

  return (
    <div className="relative inline-block">
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={disabled || isLoading}
        whileHover={disabled || isLoading ? undefined : { scale: 1.05 }}
        whileTap={disabled || isLoading ? undefined : { scale: 0.95 }}
        className={`
          ${SIZE_CLASSES[size]}
          relative overflow-hidden rounded-full
          border-2 border-dashed border-accent/30
          bg-card
          transition-all duration-200
          ${
            disabled || isLoading
              ? "opacity-50 cursor-not-allowed"
              : "cursor-pointer hover:border-accent/60 hover:shadow-[0_0_15px_rgba(255,107,0,0.2)]"
          }
        `}
      >
        {displayUrl ? (
          <img
            src={displayUrl}
            alt="Avatar"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg
              className={`${ICON_SIZES[size]} text-meta`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-page/80">
            <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        )}

        {/* Hover overlay */}
        {!isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-page/60 opacity-0 transition-opacity hover:opacity-100">
            <svg
              className="h-6 w-6 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </div>
        )}
      </motion.button>

      {/* Remove button */}
      {displayUrl && !disabled && !isLoading && (
        <motion.button
          type="button"
          onClick={handleRemove}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="
            absolute -right-1 -top-1
            flex h-6 w-6 items-center justify-center
            rounded-full
            border border-danger/50 bg-page
            text-danger
            transition-colors
            hover:border-danger hover:bg-danger/20
            cursor-pointer
          "
        >
          <svg
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </motion.button>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
