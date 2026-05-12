/**
 * ZIP Validator Utility.
 * Validates skill package ZIP files client-side using JSZip.
 * Enforces the standard skill package structure.
 *
 * Returns structured `ErrorEntry` items (`{ key, params? }`) instead of
 * pre-rendered strings so the consumer can translate at render time.
 *
 * @module utils/zipValidator
 */

import JSZip from "jszip";
import { extractFrontmatter, type SkillFrontmatter } from "@/utils/frontmatter";
import type { SkillPackageFile, SkillFolder } from "@/types/skillPackage";

/** Structured i18n entry — key + interpolation params. */
export interface ErrorEntry {
  key: string;
  params?: Record<string, string | number>;
}

export interface ZipValidationResult {
  status: "valid" | "invalid" | "warning";
  files: SkillPackageFile[];
  metadata: SkillFrontmatter | null;
  errors: ErrorEntry[];
  warnings: ErrorEntry[];
}

/** Recognized top-level directories in a skill package */
const RECOGNIZED_DIRS = new Set(["scripts", "references", "assets"]);

/** OS-generated junk files to filter out */
const JUNK_FILE_NAMES = new Set([
  ".DS_Store",
  ".ds_store",
  "Thumbs.db",
  "thumbs.db",
  "desktop.ini",
  ".gitkeep",
  ".keep",
]);

/**
 * Checks if a path should be filtered out (OS junk files, hidden files in paths, etc.)
 */
function isJunkPath(relativePath: string): boolean {
  // Filter __MACOSX resource fork directory
  if (relativePath === "__MACOSX/" || relativePath.startsWith("__MACOSX/")) {
    return true;
  }

  // Get the filename (last segment)
  const segments = relativePath.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] || "";

  // Filter known junk filenames
  if (JUNK_FILE_NAMES.has(fileName)) {
    return true;
  }

  // Filter hidden files/directories (starting with .) anywhere in path
  // but keep files that START with . only at the beginning of a segment
  for (const segment of segments) {
    if (segment.startsWith(".") && segment !== ".") {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether file content appears to be binary (non-text).
 * Scans the first 512 bytes for null bytes as a heuristic.
 */
export function isBinaryContent(content: Uint8Array): boolean {
  const checkLength = Math.min(content.length, 512);
  for (let i = 0; i < checkLength; i++) {
    if (content[i] === 0) return true;
  }
  return false;
}

/**
 * Determines the skill folder for a given file path.
 */
function getFolder(path: string): SkillFolder {
  const firstSegment = path.split("/")[0];
  if (RECOGNIZED_DIRS.has(firstSegment)) {
    return firstSegment as SkillFolder;
  }
  return "root";
}

/**
 * Strips a common root folder prefix if the ZIP wraps everything in one directory.
 * For example: "my-skill/SKILL.md" becomes "SKILL.md".
 */
function normalizeEntries(
  entries: Array<{ path: string; dir: boolean }>,
): { normalized: Array<{ path: string; dir: boolean }>; prefix: string } {
  const topLevelEntries = entries.filter(
    (e) => !e.path.includes("/") || (e.dir && e.path.split("/").filter(Boolean).length === 1),
  );

  // If there is exactly one top-level directory and no top-level files,
  // the ZIP wraps everything in a single root folder
  if (
    topLevelEntries.length === 1 &&
    topLevelEntries[0].dir
  ) {
    const prefix = topLevelEntries[0].path.endsWith("/")
      ? topLevelEntries[0].path
      : topLevelEntries[0].path + "/";

    const normalized = entries
      .filter((e) => e.path !== prefix && e.path.startsWith(prefix))
      .map((e) => ({
        path: e.path.slice(prefix.length),
        dir: e.dir,
      }));

    return { normalized, prefix };
  }

  return { normalized: entries, prefix: "" };
}

/**
 * Validates a ZIP file against the standard skill package structure.
 * Returns file tree, metadata, and validation results.
 */
export async function validateSkillZip(
  zipFile: File,
): Promise<ZipValidationResult> {
  const errors: ErrorEntry[] = [];
  const warnings: ErrorEntry[] = [];
  const files: SkillPackageFile[] = [];

  let zip: JSZip;
  try {
    const buffer = await zipFile.arrayBuffer();
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return {
      status: "invalid",
      files: [],
      metadata: null,
      errors: [{ key: "errors.zip.readFailed" }],
      warnings: [],
    };
  }

  // Collect all entries, filtering out OS junk files
  const rawEntries: Array<{ path: string; dir: boolean }> = [];
  zip.forEach((relativePath, entry) => {
    if (isJunkPath(relativePath)) return;
    rawEntries.push({ path: relativePath, dir: entry.dir });
  });

  const { normalized, prefix } = normalizeEntries(rawEntries);

  // Find all SKILL.md files
  const skillMdPaths = normalized.filter(
    (e) => !e.dir && e.path.toLowerCase() === "skill.md",
  );
  const nestedSkillMds = normalized.filter(
    (e) => !e.dir && e.path.toLowerCase().endsWith("/skill.md"),
  );

  if (skillMdPaths.length === 0 && nestedSkillMds.length > 0) {
    errors.push({ key: "errors.zip.skillMdNested" });
  } else if (skillMdPaths.length === 0) {
    errors.push({ key: "errors.zip.skillMdRootRequired" });
  }

  if (skillMdPaths.length + nestedSkillMds.length > 1) {
    errors.push({ key: "errors.zip.skillMdMultiple" });
  }

  // Check for unrecognized top-level directories
  const topDirs = new Set<string>();
  for (const entry of normalized) {
    if (entry.dir && !entry.path.includes("/")) {
      topDirs.add(entry.path.replace("/", ""));
    } else if (!entry.dir && entry.path.includes("/")) {
      const firstDir = entry.path.split("/")[0];
      topDirs.add(firstDir);
    }
  }

  const unrecognizedDirs = [...topDirs].filter(
    (d) => !RECOGNIZED_DIRS.has(d) && d.toLowerCase() !== "skill.md",
  );

  if (unrecognizedDirs.length > 0) {
    warnings.push({
      key: "errors.zip.unrecognizedDirs",
      params: {
        dirs: unrecognizedDirs.map((d) => d + "/").join(", "),
      },
    });
  }

  // If there are errors, return early
  if (errors.length > 0) {
    return { status: "invalid", files: [], metadata: null, errors, warnings };
  }

  // Extract files
  let metadata: SkillFrontmatter | null = null;

  for (const entry of normalized) {
    if (entry.dir) continue;

    const zipPath = prefix + entry.path;
    const zipEntry = zip.file(zipPath);
    if (!zipEntry) continue;

    const rawContent = await zipEntry.async("uint8array");
    const binary = isBinaryContent(rawContent);
    let textContent: string | null = null;

    if (!binary) {
      textContent = new TextDecoder().decode(rawContent);
    }

    // Parse SKILL.md frontmatter
    if (entry.path.toLowerCase() === "skill.md" && textContent) {
      metadata = extractFrontmatter(textContent);
      if (!metadata) {
        warnings.push({ key: "errors.zip.frontmatterUnparseable" });
      }
    }

    files.push({
      id: entry.path,
      path: entry.path,
      folder: getFolder(entry.path),
      content: textContent,
      file: null,
      size: rawContent.length,
      generated: false,
    });
  }

  const status = warnings.length > 0 ? "warning" : "valid";
  return { status, files, metadata, errors, warnings };
}
