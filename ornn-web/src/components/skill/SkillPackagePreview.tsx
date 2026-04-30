/**
 * Skill Package Preview Component.
 * Two-panel preview showing folder tree and file content viewer.
 * Reused across Guided Step 4, Free Mode, and Generative Mode.
 * @module components/skill/SkillPackagePreview
 */

import { useState, useEffect, useCallback, useRef } from "react";
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
 * Walk the tree top-down looking ONLY for `SKILL.md` (anywhere). The
 * helper is split out from `findDefaultFileId` so the recursion can't
 * accidentally fall through to the "any first file" branch — earlier
 * versions of this code mixed both passes in one function and would
 * pick `references/api-reference.md` over a root-level `SKILL.md`
 * whenever the folder happened to come first in the tree.
 */
function findSkillMdId(files: FileNode[]): string | undefined {
  for (const node of files) {
    if (node.type === "file" && node.name === "SKILL.md") return node.id;
    if (node.children) {
      const found = findSkillMdId(node.children);
      if (found) return found;
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

/**
 * Default file to land on when the viewer mounts. Always prefer
 * `SKILL.md` (at any depth — but in practice it's always at the package
 * root); only when no `SKILL.md` exists do we fall back to the first
 * file we can find.
 */
function findDefaultFileId(files: FileNode[]): string | undefined {
  return findSkillMdId(files) ?? findFirstFile(files);
}

/** Horizontally resizable two-pane layout with a draggable divider */
function ResizablePanes({
  children,
  className = "",
  style,
}: {
  children: [React.ReactNode, React.ReactNode];
  className?: string;
  style?: React.CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(30); // percentage
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftWidth(Math.min(Math.max(pct, 15), 60));
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div ref={containerRef} className={`flex flex-row ${className}`} style={style}>
      <div style={{ width: `${leftWidth}%` }} className="shrink-0 h-full">
        {children[0]}
      </div>
      {/* Draggable divider */}
      <div
        onMouseDown={handleMouseDown}
        className="shrink-0 w-2 cursor-col-resize flex items-center justify-center group"
      >
        <div className="w-0.5 h-8 rounded-full bg-accent/20 group-hover:bg-accent/50 transition-colors" />
      </div>
      <div style={{ width: `${100 - leftWidth}%` }} className="min-w-0 h-full">
        {children[1]}
      </div>
    </div>
  );
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

  // Default-select SKILL.md when files arrive (or change). Three triggers:
  //   1. Initial render had no files yet (async fetch) — `selectedFileId`
  //      is undefined; pick SKILL.md once files land.
  //   2. The currently-selected file disappeared from the tree (rename,
  //      version switch, deletion) — fall back to SKILL.md.
  //   3. Version switch / refresh produced a different default — re-pick
  //      so the viewer always lands on SKILL.md unless the user explicitly
  //      navigated away.
  useEffect(() => {
    const fallback = findDefaultFileId(files);
    if (!selectedFileId) {
      if (fallback) setSelectedFileId(fallback);
      return;
    }
    if (!fileContents.has(selectedFileId)) {
      setSelectedFileId(fallback);
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
    <div className={`flex flex-col ${className}`}>
      {/* Metadata summary bar */}
      {metadata && (
        <div className="glass rounded border border-accent/10 p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-display text-lg text-strong">
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
              <span className="font-text text-xs text-meta ml-auto">
                by {authorName}
              </span>
            )}
          </div>
          {metadata.description && (
            <p className="font-text text-sm text-meta mt-2">
              {metadata.description}
            </p>
          )}
        </div>
      )}

      {/* Two-column layout with draggable divider */}
      <ResizablePanes className="flex-1 min-h-0" style={{ minHeight: "300px" }}>
        {/* Left: File tree */}
        <div className="rounded border border-accent/10 bg-card overflow-hidden flex flex-col h-full">
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
        <div className="min-w-0 h-full">
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
            <div className="flex items-center justify-center h-full rounded border border-accent/10 bg-page">
              <p className="font-text text-sm text-meta">
                Select a file to view its content
              </p>
            </div>
          )}
        </div>
      </ResizablePanes>
    </div>
  );
}
