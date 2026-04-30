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

/**
 * Horizontally resizable two-pane layout with a draggable divider.
 * The divider is a 1px hairline; the surrounding 8px hit area is
 * invisible so the seam reads as a single hairline at rest, no
 * pill-styled grip floating in the middle.
 */
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
      <div style={{ width: `${leftWidth}%` }} className="h-full shrink-0">
        {children[0]}
      </div>
      {/* Draggable divider — hairline at rest, ember on hover. */}
      <div
        onMouseDown={handleMouseDown}
        className="group relative h-full w-px shrink-0 cursor-col-resize bg-subtle"
      >
        <div className="pointer-events-none absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent/20 transition-colors" />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-subtle group-hover:bg-accent/60 transition-colors" />
      </div>
      <div style={{ width: `calc(${100 - leftWidth}% - 1px)` }} className="h-full min-w-0">
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
      {/* Metadata summary bar — kept as its own card above the package
          panel; this is a different concern (skill identity) from the
          file browser below. */}
      {metadata && (
        <div className="card-impression mb-4 rounded border border-subtle bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-display text-lg font-semibold text-strong">
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
              <span className="ml-auto font-text text-xs text-meta">
                by {authorName}
              </span>
            )}
          </div>
          {metadata.description && (
            <p className="mt-2 font-text text-sm text-meta">
              {metadata.description}
            </p>
          )}
        </div>
      )}

      {/* Unified package panel: the file tree and the viewer share one
          rounded letterpressed surface, separated by a hairline draggable
          divider. No double borders, no nested cards. */}
      <div
        className="card-impression flex-1 overflow-hidden rounded border border-subtle bg-card"
        style={{ minHeight: "300px" }}
      >
        <ResizablePanes className="h-full min-h-0">
          {/* Left: file tree (no outer chrome — parent panel owns it) */}
          <div className="flex h-full flex-col">
            <FileTree
              files={files}
              selectedId={selectedFileId}
              onSelect={handleFileSelect}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onDelete={onFileDelete}
            />
          </div>

          {/* Right: file content viewer (also naked) */}
          <div className="h-full min-w-0">
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
              <div className="flex h-full items-center justify-center">
                <p className="font-text text-sm text-meta">
                  Select a file to view its content
                </p>
              </div>
            )}
          </div>
        </ResizablePanes>
      </div>
    </div>
  );
}
