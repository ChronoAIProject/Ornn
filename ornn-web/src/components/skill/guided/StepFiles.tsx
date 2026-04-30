/**
 * Guided Wizard Step 3: Supporting Files.
 * Folder-based file uploads for scripts, references, and assets.
 * @module components/skill/guided/StepFiles
 */

import { motion } from "framer-motion";
import { FolderFileUpload } from "@/components/form/FolderFileUpload";
import type { UploadableFolder } from "@/types/skillPackage";
import { useTranslation } from "react-i18next";

export interface StepFilesProps {
  folderFiles: Map<UploadableFolder, File[]>;
  onUpload: (folder: UploadableFolder, file: File) => void;
  onRemove: (folder: UploadableFolder, index: number) => void;
}

export function StepFiles({ folderFiles, onUpload, onRemove }: StepFilesProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      key="files"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h2 className="font-display text-lg text-accent mb-6">
        {t("guided.filesTitle")}
      </h2>
      <p className="font-text text-sm text-meta mb-4">
        {t("guided.filesDesc")}
      </p>

      <FolderFileUpload
        files={folderFiles}
        onUpload={onUpload}
        onRemove={onRemove}
      />
    </motion.div>
  );
}
