/**
 * Guided Wizard Step 3: Supporting Files.
 * Folder-based file uploads for scripts, references, and assets.
 * @module components/skill/guided/StepFiles
 */

import { motion } from "framer-motion";
import { FolderFileUpload } from "@/components/form/FolderFileUpload";
import type { UploadableFolder } from "@/types/skillPackage";

export interface StepFilesProps {
  folderFiles: Map<UploadableFolder, File[]>;
  onUpload: (folder: UploadableFolder, file: File) => void;
  onRemove: (folder: UploadableFolder, index: number) => void;
}

export function StepFiles({ folderFiles, onUpload, onRemove }: StepFilesProps) {
  return (
    <motion.div
      key="files"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h2 className="font-heading text-lg text-neon-cyan mb-6">
        Supporting Files (Optional)
      </h2>
      <p className="font-body text-sm text-text-muted mb-4">
        Upload script files, reference docs, or assets to specific
        folders. SKILL.md is auto-generated from your metadata and
        content.
      </p>

      <FolderFileUpload
        files={folderFiles}
        onUpload={onUpload}
        onRemove={onRemove}
      />
    </motion.div>
  );
}
