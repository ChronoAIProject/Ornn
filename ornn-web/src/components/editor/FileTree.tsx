/**
 * File Tree Component.
 * Displays a hierarchical file structure with create/delete capabilities.
 * Forge Workshop styled with neon accents.
 * @module components/editor/FileTree
 */

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
  content?: string;
}

export interface FileTreeProps {
  files: FileNode[];
  selectedId?: string;
  onSelect: (file: FileNode) => void;
  onCreateFile?: (parentId: string | null, name: string) => void;
  onCreateFolder?: (parentId: string | null, name: string) => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, newName: string) => void;
  className?: string;
}

/** File icon */
function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

/** Folder icon */
function FolderIcon({ className, isOpen }: { className?: string; isOpen?: boolean }) {
  if (isOpen) {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

/** Chevron icon */
function ChevronIcon({ className, isOpen }: { className?: string; isOpen: boolean }) {
  return (
    <svg
      className={`${className} transform transition-transform ${isOpen ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** Plus icon */
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

/** Trash icon */
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

interface TreeNodeProps {
  node: FileNode;
  level: number;
  selectedId?: string;
  expandedIds: Set<string>;
  onSelect: (file: FileNode) => void;
  onToggle: (id: string) => void;
  onCreateFile?: (parentId: string | null) => void;
  onDelete?: (id: string) => void;
  /** Currently active creation state */
  creatingState?: { type: "file" | "folder"; parentId: string | null } | null;
  newItemName?: string;
  onNewItemNameChange?: (name: string) => void;
  onConfirmCreate?: () => void;
  onCancelCreate?: () => void;
}

function TreeNode({
  node,
  level,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
  onCreateFile,
  onDelete,
  creatingState,
  newItemName,
  onNewItemNameChange,
  onConfirmCreate,
  onCancelCreate,
}: TreeNodeProps) {
  const isFolder = node.type === "folder";
  const isExpanded = expandedIds.has(node.id);
  const isSelected = node.id === selectedId;
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    if (isFolder) {
      onToggle(node.id);
    } else {
      onSelect(node);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`
          flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer
          transition-colors duration-150
          ${isSelected
            ? "bg-accent/15 text-accent"
            : "text-meta hover:bg-elevated hover:text-strong"
          }
        `}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {/* Expand chevron for folders */}
        {isFolder && (
          <ChevronIcon className="h-3 w-3 shrink-0" isOpen={isExpanded} />
        )}

        {/* Icon */}
        {isFolder ? (
          <FolderIcon
            className={`h-4 w-4 shrink-0 ${isSelected ? "text-accent" : "text-warning"}`}
            isOpen={isExpanded}
          />
        ) : (
          <FileIcon
            className={`h-4 w-4 shrink-0 ml-3.5 ${isSelected ? "text-accent" : ""}`}
          />
        )}

        {/* Name */}
        <span className="font-mono text-sm truncate flex-1">{node.name}</span>

        {/* Actions (shown on hover) */}
        {isHovered && (
          <div className="flex items-center gap-0.5">
            {isFolder && onCreateFile && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateFile(node.id);
                }}
                className="p-1 rounded hover:bg-accent/20 text-meta hover:text-accent cursor-pointer"
                title="New file"
              >
                <PlusIcon className="h-3 w-3" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(node.id);
                }}
                className="p-1 rounded hover:bg-danger/20 text-meta hover:text-danger cursor-pointer"
                title="Delete"
              >
                <TrashIcon className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Children */}
      <AnimatePresence>
        {isFolder && isExpanded && node.children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Inline creation input inside this folder */}
            {creatingState && creatingState.parentId === node.id && onNewItemNameChange && onConfirmCreate && onCancelCreate && (
              <div className="py-1" style={{ paddingLeft: `${(level + 1) * 12 + 8}px`, paddingRight: "8px" }}>
                <input
                  type="text"
                  value={newItemName ?? ""}
                  onChange={(e) => onNewItemNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onConfirmCreate();
                    if (e.key === "Escape") onCancelCreate();
                  }}
                  onBlur={onCancelCreate}
                  autoFocus
                  placeholder={creatingState.type === "file" ? "filename.md" : "folder-name"}
                  className="w-full px-2 py-1 rounded bg-elevated border border-accent/30 font-mono text-sm text-strong placeholder:text-meta/50 focus:outline-none focus:border-accent"
                />
              </div>
            )}
            {node.children.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                level={level + 1}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onSelect={onSelect}
                onToggle={onToggle}
                onCreateFile={onCreateFile}
                onDelete={onDelete}
                creatingState={creatingState}
                newItemName={newItemName}
                onNewItemNameChange={onNewItemNameChange}
                onConfirmCreate={onConfirmCreate}
                onCancelCreate={onCancelCreate}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Compute initial expanded IDs: always expand "root" and any single
 * top-level folder so the package contents are visible immediately.
 */
function computeInitialExpanded(files: FileNode[]): Set<string> {
  const ids = new Set<string>(["root"]);
  if (files.length === 1 && files[0].type === "folder") {
    ids.add(files[0].id);
  }
  return ids;
}

export function FileTree({
  files,
  selectedId,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onDelete,
  onRename: _onRename,
  className = "",
}: FileTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => computeInitialExpanded(files));

  // Re-expand when files change (e.g., ZIP loads after initial render)
  useEffect(() => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add("root");
      if (files.length === 1 && files[0].type === "folder") {
        next.add(files[0].id);
      }
      return next;
    });
  }, [files]);
  const [isCreating, setIsCreating] = useState<{
    type: "file" | "folder";
    parentId: string | null;
  } | null>(null);
  const [newItemName, setNewItemName] = useState("");

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleStartCreate = useCallback((parentId: string | null) => {
    setIsCreating({ type: "file", parentId });
    setNewItemName("");
    // Auto-expand the target folder so the input is visible
    if (parentId) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(parentId);
        return next;
      });
    }
  }, []);

  const handleConfirmCreate = useCallback(() => {
    if (isCreating && newItemName.trim()) {
      if (isCreating.type === "file") {
        onCreateFile?.(isCreating.parentId, newItemName.trim());
      } else {
        onCreateFolder?.(isCreating.parentId, newItemName.trim());
      }
    }
    setIsCreating(null);
    setNewItemName("");
  }, [isCreating, newItemName, onCreateFile, onCreateFolder]);

  const handleCancelCreate = useCallback(() => {
    setIsCreating(null);
    setNewItemName("");
  }, []);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header — same vertical rhythm as the file-viewer header on the
          right so they line up across the unified panel. */}
      <div className="flex shrink-0 items-center border-b border-subtle bg-elevated/40 px-4 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-meta">
          Files
        </span>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {/* Tree nodes */}
        {files.map((file) => (
          <TreeNode
            key={file.id}
            node={file}
            level={0}
            selectedId={selectedId}
            expandedIds={expandedIds}
            onSelect={onSelect}
            onToggle={handleToggle}
            onCreateFile={onCreateFile ? handleStartCreate : undefined}
            onDelete={onDelete}
            creatingState={isCreating}
            newItemName={newItemName}
            onNewItemNameChange={setNewItemName}
            onConfirmCreate={handleConfirmCreate}
            onCancelCreate={handleCancelCreate}
          />
        ))}

        {/* Empty state */}
        {files.length === 0 && !isCreating && (
          <div className="px-4 py-8 text-center">
            <p className="font-text text-sm text-meta mb-2">
              No files yet
            </p>
            <button
              type="button"
              onClick={() => setIsCreating({ type: "file", parentId: null })}
              className="font-text text-sm text-accent hover:underline cursor-pointer"
            >
              Create your first file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
