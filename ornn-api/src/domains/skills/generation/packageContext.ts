/**
 * Turns an uploaded skill package ZIP into the plain-text context block
 * the multipart branch of `POST /skills/generate` prepends to the prompt.
 *
 * Split out of `routes.ts` (#1242). Only `SKILL.md` plus anything under
 * `scripts/`, `references/` and `assets/` is read — the same folders the
 * upload validator allows at the package root.
 *
 * @module domains/skills/generation/packageContext
 */

import JSZip from "jszip";
import { resolveZipRoot } from "../../../shared/utils/zip";
import { createLogger } from "../../../shared/logger";

const logger = createLogger("skillGenerationPackageContext");

const RELEVANT_FILES = ["SKILL.md"];
const RELEVANT_DIRS = ["scripts/", "references/", "assets/"];

/**
 * Read content from a ZIP package for analysis.
 */
export async function analyzePackageContent(zipBuffer: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const allPaths = Object.keys(zip.files);
  resolveZipRoot(zip, allPaths);
  const parts: string[] = [];

  for (const path of allPaths) {
    const file = zip.files[path];
    // allPaths is `Object.keys(zip.files)`, but noUncheckedIndexedAccess
    // (#450) widens the lookup to `T | undefined`. Defensive skip.
    if (!file || file.dir) continue;

    // Check if this is a relevant file
    const segments = path.split("/").filter(Boolean);
    let relativePath = path;
    if (segments.length > 1) {
      const firstEntry = segments[0]!;
      const folderEntry = zip.files[firstEntry + "/"];
      if (folderEntry && folderEntry.dir) {
        relativePath = segments.slice(1).join("/");
      }
    }

    const isRelevant = RELEVANT_FILES.includes(relativePath) ||
      RELEVANT_DIRS.some((d) => relativePath.startsWith(d));

    if (isRelevant) {
      try {
        const content = await file.async("string");
        parts.push(`--- ${relativePath} ---\n${content}`);
      } catch (err) {
        // Skip binary or unreadable files. Log so an upload that's
        // 100% binary doesn't silently produce an empty generation
        // context (#579).
        logger.debug({ err, relativePath }, "generation: skipping unreadable file");
      }
    }
  }

  return parts.join("\n\n");
}
