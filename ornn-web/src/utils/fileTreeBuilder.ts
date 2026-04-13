/**
 * File Tree Builder Utility.
 * Constructs FileNode trees and reads file contents for skill package previews.
 * Shared between guided and generative creation modes.
 * @module utils/fileTreeBuilder
 */

import type { FileNode } from "@/components/editor/FileTree";
import type { UploadableFolder } from "@/types/skillPackage";

/** Single entry in the file tree. */
export interface FileTreeEntry {
  path: string;
  type: "file" | "folder";
  viewable: boolean;
  size: number;
}

/**
 * Build a FileNode tree from folder files and a root SKILL.md entry.
 */
export function buildFileTreeFromFolders(
  skillName: string,
  folderFiles: Map<UploadableFolder, File[]>,
): FileNode[] {
  const children: FileNode[] = [
    { id: "SKILL.md", name: "SKILL.md", type: "file" },
  ];

  for (const [folder, files] of folderFiles) {
    if (files.length > 0) {
      children.push({
        id: folder,
        name: folder,
        type: "folder",
        children: files.map((f) => ({
          id: `${folder}/${f.name}`,
          name: f.name,
          type: "file" as const,
        })),
      });
    }
  }

  return [
    {
      id: "root",
      name: skillName || "my-skill",
      type: "folder",
      children,
    },
  ];
}

/**
 * Build a nested FileNode tree from a flat array of FileTreeEntry objects
 * returned by the file API. Splits paths by "/" to create folder hierarchy.
 */
export function buildFileTreeFromEntries(entries: FileTreeEntry[]): FileNode[] {
  const root: FileNode[] = [];
  const folderMap = new Map<string, FileNode>();

  // Ensure folders exist for every path segment
  function ensureFolder(folderPath: string): FileNode {
    const existing = folderMap.get(folderPath);
    if (existing) return existing;

    const parts = folderPath.split("/");
    const name = parts[parts.length - 1];
    const node: FileNode = { id: folderPath, name, type: "folder", children: [] };
    folderMap.set(folderPath, node);

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = ensureFolder(parentPath);
      parent.children!.push(node);
    }

    return node;
  }

  // First pass: create all explicit folder entries
  for (const entry of entries) {
    if (entry.type === "folder") {
      ensureFolder(entry.path);
    }
  }

  // Second pass: add file entries
  for (const entry of entries) {
    if (entry.type !== "file") continue;

    const parts = entry.path.split("/");
    const name = parts[parts.length - 1];
    const fileNode: FileNode = { id: entry.path, name, type: "file" };

    if (parts.length === 1) {
      root.push(fileNode);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = ensureFolder(parentPath);
      parent.children!.push(fileNode);
    }
  }

  // Sort: folders first, then files, alphabetically within each group
  function sortNodes(nodes: FileNode[]): void {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortNodes(node.children);
    }
  }

  sortNodes(root);
  return root;
}

/**
 * Read text content from uploaded files grouped by folder.
 * Binary or unreadable files are silently skipped.
 */
export async function readUploadedFileContents(
  folderFiles: Map<UploadableFolder, File[]>,
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();

  for (const [folder, files] of folderFiles) {
    for (const file of files) {
      try {
        const text = await file.text();
        contents.set(`${folder}/${file.name}`, text);
      } catch {
        // Binary files or read failures are skipped
      }
    }
  }

  return contents;
}
