import { useState, useEffect } from "react";
import JSZip from "jszip";
import type { FileNode } from "@/components/editor/FileTree";
import {
  buildFileTreeFromEntries,
  type FileTreeEntry,
} from "@/utils/fileTreeBuilder";
import { encodeErrorPayload } from "@/utils/translateError";
import { apiGetBinary, ApiClientError } from "@/services/apiClient";

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
 * Fetches a skill version's ZIP from the ornn-api proxied download endpoint
 * (#1196 — no direct chrono-bucket / presigned-URL fetch), extracts it with
 * JSZip, and returns a FileNode tree + text file contents map.
 */
export function useSkillPackage(
  guid: string | undefined,
  version: string | undefined,
): UseSkillPackageResult {
  const [files, setFiles] = useState<FileNode[]>([]);
  const [fileContents, setFileContents] = useState<Map<string, string>>(
    new Map(),
  );
  const [rawZip, setRawZip] = useState<JSZip | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guid || !version) return;

    let cancelled = false;

    async function extract() {
      setIsLoading(true);
      setError(null);

      try {
        const buffer = await apiGetBinary(
          `/api/v1/skills/${encodeURIComponent(guid!)}/versions/${encodeURIComponent(version!)}/download`,
        );
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
          // A non-2xx from the proxied download surfaces as ApiClientError;
          // map it to the same translated "download failed" payload the old
          // direct-fetch path used, preserving the status code.
          setError(
            err instanceof ApiClientError
              ? encodeErrorPayload({
                  key: "errors.api.skillPackage.downloadFailed",
                  params: { status: err.statusCode },
                })
              : err instanceof Error
                ? err.message
                : "errors.api.skillPackage.loadFailed",
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
  }, [guid, version]);

  return { files, fileContents, rawZip, isLoading, error };
}
