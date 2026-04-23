import { useState, useEffect } from "react";
import JSZip from "jszip";
import type { FileNode } from "@/components/editor/FileTree";
import {
  buildFileTreeFromEntries,
  type FileTreeEntry,
} from "@/utils/fileTreeBuilder";

/** Extensions treated as viewable text files */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".sh",
  ".bash",
  ".py",
  ".css",
  ".html",
  ".xml",
  ".csv",
  ".env",
  ".cfg",
  ".ini",
  ".conf",
  ".lock",
  ".log",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
]);

function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.includes(".")) {
    // Files without extensions (Dockerfile, Makefile, etc.) are treated as text
    return true;
  }
  const ext = lower.slice(lower.lastIndexOf("."));
  return TEXT_EXTENSIONS.has(ext);
}

interface UseSkillPackageResult {
  files: FileNode[];
  fileContents: Map<string, string>;
  rawZip: JSZip | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches a skill ZIP from a presigned URL, extracts it with JSZip,
 * and returns a FileNode tree + text file contents map.
 */
export function useSkillPackage(
  presignedUrl: string | undefined,
): UseSkillPackageResult {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [fileContents, setFileContents] = useState<Map<string, string>>(
    new Map(),
  );
  const [rawZip, setRawZip] = useState<JSZip | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!presignedUrl) return;

    let cancelled = false;

    async function extract() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(presignedUrl!);
        if (!response.ok) {
          throw new Error(`Failed to download package: ${response.status}`);
        }

        const buffer = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);

        const entries: FileTreeEntry[] = [];
        const contents = new Map<string, string>();

        const promises: Promise<void>[] = [];

        zip.forEach((relativePath, entry) => {
          // Skip macOS resource fork files
          if (relativePath.startsWith("__MACOSX/")) return;

          if (entry.dir) {
            // Remove trailing slash for folder paths
            const folderPath = relativePath.replace(/\/$/, "");
            if (folderPath) {
              entries.push({
                path: folderPath,
                type: "folder",
                viewable: false,
                size: 0,
              });
            }
          } else {
            const fileName = relativePath.split("/").pop() ?? relativePath;
            const viewable = isTextFile(fileName);

            entries.push({
              path: relativePath,
              type: "file",
              viewable,
              size: 0,
            });

            if (viewable) {
              promises.push(
                entry.async("string").then((text) => {
                  if (!cancelled) {
                    contents.set(relativePath, text);
                  }
                }),
              );
            }
          }
        });

        await Promise.all(promises);

        if (!cancelled) {
          setFiles(buildFileTreeFromEntries(entries));
          setFileContents(contents);
          setRawZip(zip);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load package",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    extract();

    return () => {
      cancelled = true;
    };
  }, [presignedUrl]);

  return { files, fileContents, rawZip, isLoading, error };
}
