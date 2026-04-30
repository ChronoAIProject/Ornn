/**
 * Skill File Browser Component.
 * Two-panel layout: file tree (left) + file viewer/editor (right).
 * Replaces the Readme tab on the SkillDetailPage.
 * @module components/skill/SkillFileBrowser
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileTree, type FileNode } from "@/components/editor/FileTree";
import { SkillFileViewer } from "@/components/skill/SkillFileViewer";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { buildFileTreeFromEntries, type FileTreeEntry } from "@/utils/fileTreeBuilder";
import { useToastStore } from "@/stores/toastStore";
import { apiGet, apiPut } from "@/services/apiClient";

/** Response from the file tree endpoint. */
interface FileTreeResponse {
  tree: FileTreeEntry[];
  contents: Record<string, string>;
}

/** Fetch the file tree and viewable contents for a skill version. */
async function fetchFileTree(skillId: string, version: string): Promise<FileTreeResponse> {
  const res = await apiGet<FileTreeResponse>(
    `/api/v1/skills/${skillId}/versions/${encodeURIComponent(version)}/files`,
  );
  return res.data!;
}

/** Update a single file's content within a skill version package. */
async function updateFileContent(
  skillId: string,
  version: string,
  filePath: string,
  content: string,
): Promise<void> {
  await apiPut(
    `/api/v1/skills/${skillId}/versions/${encodeURIComponent(version)}/files/${filePath}`,
    { content },
  );
}

const FILE_TREE_KEY = "file-tree";

function useFileTree(skillId: string, version: string) {
  return useQuery({
    queryKey: [FILE_TREE_KEY, skillId, version],
    queryFn: () => fetchFileTree(skillId, version),
    enabled: !!skillId && !!version,
  });
}

function useUpdateFile(skillId: string, version: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ filePath, content }: { filePath: string; content: string }) =>
      updateFileContent(skillId, version, filePath, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [FILE_TREE_KEY, skillId, version] });
    },
  });
}

export interface SkillFileBrowserProps {
  skillId: string;
  version: string;
  isOwner: boolean;
}

/** Check if a file path is editable (SKILL.md or scripts/*). */
function isEditablePath(path: string): boolean {
  return path === "SKILL.md" || path.startsWith("scripts/");
}

/** Find the default file to select, preferring SKILL.md. */
function findDefaultFile(nodes: FileNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === "file" && node.id === "SKILL.md") return node.id;
    if (node.children) {
      const found = findDefaultFile(node.children);
      if (found) return found;
    }
  }
  // Fallback to first file
  for (const node of nodes) {
    if (node.type === "file") return node.id;
    if (node.children) {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return undefined;
}

function findFirstFile(nodes: FileNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === "file") return node.id;
    if (node.children) {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return undefined;
}

export function SkillFileBrowser({ skillId, version, isOwner }: SkillFileBrowserProps) {
  const addToast = useToastStore((s) => s.addToast);
  const { data, isLoading, error } = useFileTree(skillId, version);
  const updateFile = useUpdateFile(skillId, version);

  const [selectedFileId, setSelectedFileId] = useState<string | undefined>();
  const [editedContent, setEditedContent] = useState<string | null>(null);

  const treeNodes = data ? buildFileTreeFromEntries(data.tree) : [];
  const contents = data?.contents ?? {};

  // Select default file when data loads
  useEffect(() => {
    if (treeNodes.length > 0 && !selectedFileId) {
      setSelectedFileId(findDefaultFile(treeNodes));
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset edited content when switching files
  useEffect(() => {
    setEditedContent(null);
  }, [selectedFileId]);

  const isViewable = selectedFileId ? selectedFileId in contents : false;
  const isEditable = isOwner && selectedFileId ? isEditablePath(selectedFileId) : false;
  const originalContent = selectedFileId ? contents[selectedFileId] ?? "" : "";
  const displayContent = editedContent ?? originalContent;
  const isDirty = editedContent !== null && editedContent !== originalContent;

  const handleFileSelect = useCallback((node: FileNode) => {
    if (node.type === "file") {
      setSelectedFileId(node.id);
    }
  }, []);

  const handleContentChange = useCallback((content: string) => {
    setEditedContent(content);
  }, []);

  const handleSave = async () => {
    if (!selectedFileId || editedContent === null) return;
    try {
      await updateFile.mutateAsync({ filePath: selectedFileId, content: editedContent });
      setEditedContent(null);
      addToast({ type: "success", message: "File saved" });
    } catch {
      addToast({ type: "error", message: "Failed to save file" });
    }
  };

  if (isLoading) {
    return (
      <div className="card-impression flex min-h-[400px] flex-col overflow-hidden rounded border border-subtle bg-card lg:flex-row">
        <div className="border-b border-subtle p-4 lg:w-1/3 lg:border-b-0 lg:border-r">
          <Skeleton lines={8} />
        </div>
        <div className="min-w-0 flex-1 p-4">
          <Skeleton lines={12} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-impression flex items-center justify-center rounded border border-danger/30 bg-card py-12">
        <p className="font-text text-sm text-danger">Failed to load files</p>
      </div>
    );
  }

  if (treeNodes.length === 0) {
    return (
      <div className="card-impression flex items-center justify-center rounded border border-subtle bg-card py-12">
        <p className="font-text text-sm text-meta">No package files available</p>
      </div>
    );
  }

  // Unified panel: one rounded letterpressed surface holding the tree
  // and the viewer side-by-side, separated by a single hairline. No
  // double borders, no nested cards — the panel reads as one object.
  return (
    <div className="space-y-3">
      <div className="card-impression flex min-h-[400px] flex-col overflow-hidden rounded border border-subtle bg-card lg:flex-row">
        {/* Left: File tree — hairline divider on the right edge stands
            in for the seam between the two halves. */}
        <div className="border-b border-subtle lg:w-1/3 lg:shrink-0 lg:border-b-0 lg:border-r">
          <FileTree
            files={treeNodes}
            selectedId={selectedFileId}
            onSelect={handleFileSelect}
          />
        </div>

        {/* Right: File viewer — fills the remaining space without an
            outer border (parent panel owns the border). */}
        <div className="min-w-0 flex-1">
          {selectedFileId ? (
            isViewable ? (
              <SkillFileViewer
                filename={selectedFileId}
                content={displayContent}
                editable={isEditable}
                onChange={isEditable ? handleContentChange : undefined}
              />
            ) : (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center px-4">
                <svg
                  className="mb-3 h-10 w-10 text-meta"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-center font-text text-sm text-meta">
                  This file type cannot be viewed online.
                  <br />
                  Download the package to access it.
                </p>
              </div>
            )
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center">
              <p className="font-text text-sm text-meta">
                Select a file to view its content
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Save button (shown when content is dirty) */}
      {isDirty && (
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            loading={updateFile.isPending}
          >
            Save Changes
          </Button>
        </div>
      )}
    </div>
  );
}
