/**
 * Guided Wizard Step 4: Review and Preview.
 * Shows the SkillPackagePreview before final submission.
 * @module components/skill/guided/StepPreview
 */

import { motion } from "framer-motion";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import type { FileNode } from "@/components/editor/FileTree";
import type { SkillMetadata } from "@/types/skillPackage";

export interface StepPreviewProps {
  files: FileNode[];
  fileContents: Map<string, string>;
  metadata: SkillMetadata | null;
  authorName?: string;
}

export function StepPreview({ files, fileContents, metadata, authorName }: StepPreviewProps) {
  return (
    <motion.div
      key="preview"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
    >
      <h2 className="font-heading text-lg text-neon-cyan mb-6">
        Review & Create
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
