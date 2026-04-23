/**
 * Compute a structured diff between two skill-package ZIPs.
 *
 * The shape is intentionally UI-friendly — the frontend renders
 * added/removed/modified lists directly, and for text files it can show
 * side-by-side content without another fetch. Binary files get hash +
 * byte counts only.
 *
 * @module domains/skills/crud/utils/versionDiff
 */

import { createHash } from "node:crypto";
import JSZip from "jszip";
import { resolveZipRoot } from "../../../../shared/utils/zip";

export interface DiffFileAdded {
  readonly path: string;
  readonly bytes: number;
  readonly hash: string;
  /** Absent for binary. Present (possibly truncated) for text files. */
  readonly content?: string;
  readonly truncated?: boolean;
  readonly isText: boolean;
}

export interface DiffFileRemoved {
  readonly path: string;
  readonly bytes: number;
  readonly hash: string;
  readonly content?: string;
  readonly truncated?: boolean;
  readonly isText: boolean;
}

export interface DiffFileModified {
  readonly path: string;
  readonly fromBytes: number;
  readonly toBytes: number;
  readonly fromHash: string;
  readonly toHash: string;
  readonly isText: boolean;
  /** Both sides' contents for text files (truncated if large). Absent for binary. */
  readonly fromContent?: string;
  readonly toContent?: string;
  readonly truncated?: boolean;
}

export interface VersionDiffResult {
  readonly files: {
    readonly added: ReadonlyArray<DiffFileAdded>;
    readonly removed: ReadonlyArray<DiffFileRemoved>;
    readonly modified: ReadonlyArray<DiffFileModified>;
    /** Paths that exist identically in both versions. Count only — no detail needed. */
    readonly unchangedCount: number;
  };
}

export interface ComputeVersionDiffOptions {
  /** Max bytes of text content to include per side per file. Default 64 KiB. */
  readonly maxContentBytesPerSide?: number;
}

const DEFAULT_MAX_CONTENT = 64 * 1024;

/** Extensions that are safe to treat as text for content inclusion. */
const TEXT_EXTENSIONS = new Set([
  "md", "markdown", "txt", "json", "yaml", "yml", "toml",
  "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "py", "rb", "go", "rs", "java", "kt", "swift",
  "sh", "bash", "zsh", "fish",
  "html", "htm", "css", "scss", "xml", "svg",
  "ini", "cfg", "conf", "env", "gitignore", "dockerfile",
]);

function isTextPath(path: string): boolean {
  const lower = path.toLowerCase();
  const lastSlash = lower.lastIndexOf("/");
  const filename = lastSlash >= 0 ? lower.slice(lastSlash + 1) : lower;
  // Dotfiles / no-extension common config names
  if (filename === "dockerfile" || filename === "makefile" || filename === "readme") return true;
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(filename.slice(dot + 1));
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Extract `path -> bytes` entries from a skill ZIP, normalizing the
 * leading skill-root folder (`skill-name/SKILL.md` -> `SKILL.md`) so
 * diffs are stable when the skill is renamed.
 */
async function extractFiles(zipBuffer: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const allPaths = Object.keys(zip.files);
  resolveZipRoot(zip, allPaths);

  const out = new Map<string, Uint8Array>();
  for (const path of allPaths) {
    const entry = zip.files[path];
    if (entry.dir) continue;
    const parts = path.split("/");
    let relative = path;
    if (parts.length > 1) {
      const rootFolder = parts[0] + "/";
      if (zip.files[rootFolder]?.dir) {
        relative = parts.slice(1).join("/");
      }
    }
    const bytes = await entry.async("uint8array");
    out.set(relative, bytes);
  }
  return out;
}

/**
 * Decode a Uint8Array as UTF-8, replacing invalid sequences. Cap at
 * `maxBytes` and signal truncation.
 */
function decodeText(bytes: Uint8Array, maxBytes: number): { content: string; truncated: boolean } {
  const slice = bytes.byteLength > maxBytes ? bytes.subarray(0, maxBytes) : bytes;
  const content = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  return { content, truncated: bytes.byteLength > maxBytes };
}

/**
 * Compute a structured diff between two skill-package ZIPs.
 */
export async function computeVersionDiff(
  fromZip: Uint8Array,
  toZip: Uint8Array,
  options: ComputeVersionDiffOptions = {},
): Promise<VersionDiffResult> {
  const maxContent = options.maxContentBytesPerSide ?? DEFAULT_MAX_CONTENT;
  const from = await extractFiles(fromZip);
  const to = await extractFiles(toZip);

  const allPaths = new Set<string>([...from.keys(), ...to.keys()]);

  const added: DiffFileAdded[] = [];
  const removed: DiffFileRemoved[] = [];
  const modified: DiffFileModified[] = [];
  let unchangedCount = 0;

  for (const path of allPaths) {
    const fromBytes = from.get(path);
    const toBytes = to.get(path);
    const isText = isTextPath(path);

    if (fromBytes && !toBytes) {
      const entry: DiffFileRemoved = {
        path,
        bytes: fromBytes.byteLength,
        hash: sha256Hex(fromBytes),
        isText,
      };
      if (isText) {
        const decoded = decodeText(fromBytes, maxContent);
        Object.assign(entry, { content: decoded.content, truncated: decoded.truncated });
      }
      removed.push(entry);
      continue;
    }

    if (!fromBytes && toBytes) {
      const entry: DiffFileAdded = {
        path,
        bytes: toBytes.byteLength,
        hash: sha256Hex(toBytes),
        isText,
      };
      if (isText) {
        const decoded = decodeText(toBytes, maxContent);
        Object.assign(entry, { content: decoded.content, truncated: decoded.truncated });
      }
      added.push(entry);
      continue;
    }

    if (fromBytes && toBytes) {
      const fromHash = sha256Hex(fromBytes);
      const toHash = sha256Hex(toBytes);
      if (fromHash === toHash) {
        unchangedCount++;
        continue;
      }
      const entry: DiffFileModified = {
        path,
        fromBytes: fromBytes.byteLength,
        toBytes: toBytes.byteLength,
        fromHash,
        toHash,
        isText,
      };
      if (isText) {
        const fromDecoded = decodeText(fromBytes, maxContent);
        const toDecoded = decodeText(toBytes, maxContent);
        Object.assign(entry, {
          fromContent: fromDecoded.content,
          toContent: toDecoded.content,
          truncated: fromDecoded.truncated || toDecoded.truncated,
        });
      }
      modified.push(entry);
    }
  }

  // Deterministic ordering for stable UI render + easier testing.
  added.sort((a, b) => a.path.localeCompare(b.path));
  removed.sort((a, b) => a.path.localeCompare(b.path));
  modified.sort((a, b) => a.path.localeCompare(b.path));

  return {
    files: {
      added,
      removed,
      modified,
      unchangedCount,
    },
  };
}
