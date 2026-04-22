/**
 * Utilities for building skill packages from individual files and metadata.
 * Used by the skill creation route handler to assemble archives from
 * guided/generative mode submissions.
 * @module utils/skillPackageBuilder
 */

import { createTarBuffer } from "../../../../shared/utils/tarBuilder";

/** Uploaded file entry with folder path metadata. */
export interface UploadedFileEntry {
  file: File;
  folder: string;
}

/** Parse a JSON string array from form body, returning empty array on failure. */
export function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Resolve author name from body value or auth context. */
export function resolveAuthorName(
  bodyValue: unknown,
  auth?: { userId: string; email: string; role: string } | null,
): string | undefined {
  if (typeof bodyValue === "string" && bodyValue.length > 0) {
    return bodyValue;
  }
  if (auth) {
    return auth.email;
  }
  return undefined;
}

/**
 * Collects individual files from form body following the file_0, file_1...
 * convention. Each file_N can have an optional file_N_folder metadata field
 * indicating the target folder (e.g., "scripts", "references", "assets").
 * If the filename already includes a folder path, that is used instead.
 */
export function collectUploadedFiles(
  body: Record<string, unknown>,
): UploadedFileEntry[] {
  const files: UploadedFileEntry[] = [];
  for (let i = 0; i < 100; i++) {
    const file = body[`file_${i}`];
    if (!(file instanceof File)) break;

    const folderMeta = body[`file_${i}_folder`];
    let folder = typeof folderMeta === "string" ? folderMeta : "";

    // If filename already has a folder prefix (e.g., "scripts/deploy.ts"), use it
    if (file.name.includes("/")) {
      folder = file.name.split("/")[0];
    }

    files.push({ file, folder });
  }
  return files;
}

/**
 * Builds a virtual .tar.gz archive from SKILL.md content and individual files.
 * Creates a temporary archive that can be passed to skillService.createSkill().
 */
export async function buildVirtualArchive(
  skillName: string,
  skillMdContent: string,
  files: UploadedFileEntry[],
): Promise<File> {
  const entries: Array<{ path: string; content: Uint8Array }> = [];

  if (skillMdContent) {
    entries.push({
      path: "SKILL.md",
      content: new TextEncoder().encode(skillMdContent),
    });
  }

  for (const { file, folder } of files) {
    const arrayBuffer = await file.arrayBuffer();
    const fileName = file.name.split("/").pop() ?? file.name;
    const filePath = folder ? `${folder}/${fileName}` : file.name;
    entries.push({
      path: filePath,
      content: new Uint8Array(arrayBuffer),
    });
  }

  const tarBuffer = createTarBuffer(entries);
  const compressed = Bun.gzipSync(tarBuffer);

  return new File([compressed], `${skillName}.tar.gz`, {
    type: "application/gzip",
  });
}

