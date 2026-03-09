/**
 * Skill Package Preview Component.
 * Two-panel preview showing folder tree and file content viewer.
 * Reused across Guided Step 4, Free Mode, and Generative Mode.
 * @module components/skill/SkillPackagePreview
 */

import { useState, useEffect } from "react";
import { FileTree, type FileNode } from "@/components/editor/FileTree";
import { SkillFileViewer } from "@/components/skill/SkillFileViewer";
import { Badge } from "@/components/ui/Badge";
import type { SkillMetadata } from "@/types/skillPackage";
import type { SkillCategory } from "@/utils/constants";

export interface SkillPackagePreviewProps {
  /** FileTree data structure */
  files: FileNode[];
  /** Map of file id -> plaintext content */
  fileContents: Map<string, string>;
  /** Extracted or generated metadata */
  metadata: SkillMetadata | null;
  /** Allow editing file content (generative mode) */
  editable?: boolean;
  /** Callback when file content changes (editable mode) */
  onContentChange?: (fileId: string, content: string) => void;
  /** Callback when a new file is created */
  onCreateFile?: (parentId: string | null, name: string) => void;
  /** Callback when a new folder is created */
  onCreateFolder?: (parentId: string | null, name: string) => void;
  /** Callback when a file is deleted */
  onFileDelete?: (fileId: string) => void;
  /** Author name (display only) */
  authorName?: string;
  className?: string;
}

/** Badge color mapping for categories */
const CATEGORY_BADGE_COLORS: Record<SkillCategory, "cyan" | "magenta" | "yellow" | "green"> = {
  plain: "cyan",
  "tool-based": "magenta",
  "runtime-based": "yellow",
  mixed: "green",
};

/** Tag color palette using deterministic hash */
const TAG_COLORS: Array<"cyan" | "magenta" | "yellow" | "green"> = [
  "cyan",
  "magenta",
  "yellow",
  "green",
];

function getTagColor(tag: string): "cyan" | "magenta" | "yellow" | "green" {
  const hash = tag.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return TAG_COLORS[hash % TAG_COLORS.length];
}

/**
 * Find the first file node (not folder) in the tree.
 * Prefers SKILL.md as the default selection.
 */
function findDefaultFileId(files: FileNode[]): string | undefined {
  for (const node of files) {
    if (node.type === "file" && node.name === "SKILL.md") return node.id;
    if (node.children) {
      // Check children for SKILL.md first
      const childResult = findDefaultFileId(node.children);
      if (childResult) return childResult;
    }
  }
  // If no SKILL.md found, return first file
  for (const node of files) {
    if (node.type === "file") return node.id;
    if (node.children) {
      const firstFile = findFirstFile(node.children);
      if (firstFile) return firstFile;
    }
  }
  return undefined;
}

function findFirstFile(nodes: FileNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === "file") return node.id;
    if (node.children) {
      const result = findFirstFile(node.children);
      if (result) return result;
    }
  }
  return undefined;
}

export function SkillPackagePreview({
  files,
  fileContents,
  metadata,
  editable = false,
  onContentChange,
  onCreateFile,
  onCreateFolder,
  onFileDelete,
  authorName,
  className = "",
}: SkillPackagePreviewProps) {
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>(
    () => findDefaultFileId(files),
  );

  // Update selection when files change
  useEffect(() => {
    if (selectedFileId && !fileContents.has(selectedFileId)) {
      setSelectedFileId(findDefaultFileId(files));
    }
  }, [files, fileContents, selectedFileId]);

  const selectedContent = selectedFileId
    ? fileContents.get(selectedFileId) ?? ""
    : "";

  const selectedFilename = selectedFileId ?? "No file selected";

  const handleFileSelect = (node: FileNode) => {
    if (node.type === "file") {
      setSelectedFileId(node.id);
    }
  };

  return (
    <div className={className}>
      {/* Metadata summary bar */}
      {metadata && (
        <div className="glass rounded-lg border border-neon-cyan/10 p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-heading text-lg text-text-primary">
              {metadata.name}
            </h3>
            <Badge color={CATEGORY_BADGE_COLORS[metadata.metadata.category]}>
              {metadata.metadata.category}
            </Badge>
            {metadata.metadata.tag.map((tag) => (
              <Badge key={tag} color={getTagColor(tag)}>
                {tag}
              </Badge>
            ))}
            {authorName && (
              <span className="font-body text-xs text-text-muted ml-auto">
                by {authorName}
              </span>
            )}
          </div>
          {metadata.description && (
            <p className="font-body text-sm text-text-muted mt-2">
              {metadata.description}
            </p>
          )}
        </div>
      )}

      {/* Two-column layout — fixed height so it never shifts */}
      <div className="flex flex-col lg:flex-row gap-4 h-[500px]">
        {/* Left: File tree */}
        <div className="lg:w-1/3 shrink-0 rounded-lg border border-neon-cyan/10 bg-bg-surface overflow-hidden flex flex-col h-full">
          <FileTree
            files={files}
            selectedId={selectedFileId}
            onSelect={handleFileSelect}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onDelete={onFileDelete}
          />
        </div>

        {/* Right: File content viewer */}
        <div className="lg:w-2/3 min-w-0 h-full">
          {selectedFileId ? (
            <SkillFileViewer
              filename={selectedFilename}
              content={selectedContent}
              editable={editable}
              onChange={
                onContentChange
                  ? (content) => onContentChange(selectedFileId, content)
                  : undefined
              }
              isBinary={!fileContents.has(selectedFileId)}
              className="h-full"
            />
          ) : (
            <div className="flex items-center justify-center h-full rounded-lg border border-neon-cyan/10 bg-bg-deep">
              <p className="font-body text-sm text-text-muted">
                Select a file to view its content
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
