/**
 * Backend zip-bomb defense (#633).
 *
 * `#443` shipped the same caps on the web client (`zipValidator.ts` in
 * `ornn-web`), but every other client — SDK, MCP, raw `curl`, agents
 * over HTTP — bypasses them. This module mirrors the protection on
 * the server so the publish path can't be coerced into accepting a
 * 50 KB ZIP that uncompresses to 500 MB inside an extraction loop or
 * an AgentSeal subprocess.
 *
 * The guards walk entries WITHOUT extracting them — `_data.uncompressedSize`
 * is parsed from the ZIP central directory at `loadAsync` time, so we
 * decide whether to proceed before any expensive I/O.
 *
 * Three caps:
 *   - cumulative uncompressed size (default 50 MiB)
 *   - per-entry uncompressed size (default 25 MiB)
 *   - file count (default 1000)
 *
 * Plus a compression-ratio sanity check (50:1) — the classic zip-bomb
 * signature catches things the per-entry cap would miss when an
 * attacker spreads payload across many entries.
 *
 * @module shared/utils/zipLimits
 */

import JSZip from "jszip";
import { AppError } from "../types/index";

/** Default 50 MiB cumulative cap — matches the client-side guard in `ornn-web`. */
export const DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/** Default 25 MiB per-entry cap — catches a single oversized file even if the total stays under the cap. */
export const DEFAULT_MAX_ENTRY_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;

/** Default 1000 entries — a real skill package fits in ~50 files. */
export const DEFAULT_MAX_FILE_COUNT = 1000;

/**
 * Compression-ratio sanity cap. `uncompressed / compressed > 50` is
 * the classic zip-bomb signature — legitimate text/code packages
 * compress around 3–10×, never 50×. Set high enough that a tiny
 * package with one near-empty entry doesn't false-positive (the
 * compressed lower bound below also gates this).
 */
export const DEFAULT_MAX_COMPRESSION_RATIO = 50;

/**
 * Don't bother running the ratio check when the compressed payload
 * is tiny — ZIP header overhead dominates and ratio loses meaning.
 * 4 KB is a safe lower bound (smaller than any plausible bomb).
 */
const RATIO_CHECK_MIN_COMPRESSED_BYTES = 4 * 1024;

export interface ZipLimitsConfig {
  maxTotalUncompressedBytes?: number;
  maxEntryUncompressedBytes?: number;
  maxFileCount?: number;
  maxCompressionRatio?: number;
}

/**
 * Throws `AppError.payloadTooLarge` with a stable lowercase_snake_case
 * `code` on any cap violation. Reads from the JSZip central directory
 * — does NOT extract any file. Safe to call before
 * `validateZipFormat` / the AgentSeal scan.
 *
 * Codes (per CONVENTIONS.md §1.4):
 *   - `uncompressed_too_large` — cumulative or per-entry cap exceeded
 *   - `too_many_files` — entry count cap exceeded
 *   - `invalid_zip` — the buffer isn't a parseable ZIP
 */
export async function enforceZipLimits(
  zipBuffer: Uint8Array,
  cfg: ZipLimitsConfig = {},
): Promise<void> {
  const maxTotal = cfg.maxTotalUncompressedBytes ?? DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES;
  const maxEntry = cfg.maxEntryUncompressedBytes ?? DEFAULT_MAX_ENTRY_UNCOMPRESSED_BYTES;
  const maxFiles = cfg.maxFileCount ?? DEFAULT_MAX_FILE_COUNT;
  const maxRatio = cfg.maxCompressionRatio ?? DEFAULT_MAX_COMPRESSION_RATIO;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (err) {
    throw new AppError(
      400,
      "invalid_zip",
      `Uploaded file is not a valid ZIP archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > maxFiles) {
    throw new AppError(413, "too_many_files",
      `ZIP contains ${entries.length} files; limit is ${maxFiles}. Reduce file count or split into multiple skills.`,
    );
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    // JSZip stashes the entry's uncompressed size on `_data.uncompressedSize`.
    // Cast through `unknown` because the field is intentionally private
    // and not part of the public type surface — the central-directory
    // parser sets it at `loadAsync` time, so it's available without
    // touching the entry payload.
    const data = (entry as unknown as {
      _data?: { uncompressedSize?: number };
    })._data;
    const size = data?.uncompressedSize ?? 0;

    if (size > maxEntry) {
      throw new AppError(413, "uncompressed_too_large",
        `ZIP entry '${entry.name}' is ${formatBytes(size)} uncompressed; per-entry limit is ${formatBytes(maxEntry)}.`,
      );
    }
    totalUncompressed += size;
    if (totalUncompressed > maxTotal) {
      throw new AppError(413, "uncompressed_too_large",
        `ZIP uncompressed size exceeds ${formatBytes(maxTotal)} (would extract to at least ${formatBytes(totalUncompressed)}).`,
      );
    }
  }

  // Ratio check — only meaningful on payloads big enough that the
  // ZIP header overhead doesn't dominate.
  if (
    zipBuffer.byteLength >= RATIO_CHECK_MIN_COMPRESSED_BYTES &&
    totalUncompressed > 0
  ) {
    const ratio = totalUncompressed / zipBuffer.byteLength;
    if (ratio > maxRatio) {
      throw new AppError(413, "uncompressed_too_large",
        `ZIP compression ratio ${ratio.toFixed(1)}× exceeds ${maxRatio}× — refuse to extract (classic zip-bomb signature).`,
      );
    }
  }
}

/** Compact human-readable byte count: 1.5 MiB / 800 KiB / 42 B. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

/** Exported for direct testing. */
export const __test__ = { formatBytes, RATIO_CHECK_MIN_COMPRESSED_BYTES };
