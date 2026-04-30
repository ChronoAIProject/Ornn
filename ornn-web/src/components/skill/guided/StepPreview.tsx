/**
 * Guided Wizard Step 4: Review and Preview.
 * Shows the SkillPackagePreview before final submission.
 * @module components/skill/guided/StepPreview
 */

import { motion } from "framer-motion";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import type { FileNode } from "@/components/editor/FileTree";
import type { SkillMetadata } from "@/types/skillPackage";
import { useTranslation } from "react-i18next";

export interface StepPreviewProps {
  files: FileNode[];
  fileContents: Map<string, string>;
  metadata: SkillMetadata | null;
  authorName?: string;
}

export function StepPreview({ files, fileContents, metadata, authorName }: StepPreviewProps) {
  const { t } = useTranslation();
  return (
    <motion.div
      key="preview"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h2 className="font-display text-lg text-accent mb-6">
        {t("guided.previewTitle")}
      </h2>

      <SkillPackagePreview
        files={files}
        fileContents={fileContents}
        metadata={metadata}
        authorName={authorName}
      />
    </motion.div>
  );
}
