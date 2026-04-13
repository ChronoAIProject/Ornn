/**
 * ZIP parsing and validation utilities.
 * @module shared/utils/zip
 */

import JSZip from "jszip";

export interface ZipRoot {
  rootFolderName: string | null;
  rootEntries: string[];
  getFile: (name: string) => JSZip.JSZipObject | null;
}

/**
 * Resolve the root of a ZIP archive.
 * ZIP files may contain files at the top level or under a single root folder.
 */
export function resolveZipRoot(zip: JSZip, allPaths: string[]): ZipRoot {
  const cleanPaths = allPaths.filter((p) => !p.startsWith("__MACOSX/") && p !== "__MACOSX");
  const topLevel = new Set<string>();
  for (const path of cleanPaths) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length > 0) {
      topLevel.add(parts[0]);
    }
  }

  const topLevelEntries = Array.from(topLevel);

  if (topLevelEntries.length === 1) {
    const candidate = topLevelEntries[0];
    const candidateFolder = zip.files[candidate + "/"];
    const hasNestedFiles = cleanPaths.some((p) => p.startsWith(candidate + "/") && p !== candidate + "/");
    if ((candidateFolder && candidateFolder.dir) || hasNestedFiles) {
      const prefix = candidate + "/";
      const innerEntries = new Set<string>();
      for (const path of cleanPaths) {
        if (path.startsWith(prefix) && path !== prefix) {
          const relative = path.slice(prefix.length);
          const parts = relative.split("/").filter(Boolean);
          if (parts.length > 0) {
            innerEntries.add(parts[0]);
          }
        }
      }
      return {
        rootFolderName: candidate,
        rootEntries: Array.from(innerEntries),
        getFile: (name: string) => zip.files[prefix + name] ?? null,
      };
    }
  }

  return {
    rootFolderName: null,
    rootEntries: topLevelEntries,
    getFile: (name: string) => zip.files[name] ?? null,
  };
}
