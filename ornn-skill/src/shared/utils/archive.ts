import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const VALID_EXTENSIONS = [".tar.gz", ".tgz", ".zip"];

/** Check if a filename has a supported archive extension. */
export function isValidArchiveType(filename: string): boolean {
  const lower = filename.toLowerCase();
  return VALID_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Extract an archive to a destination directory. Uses Bun.spawn for tar and unzip. */
export async function extractArchive(
  filePath: string,
  destDir: string,
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const lower = filePath.toLowerCase();

  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    const proc = Bun.spawn(["tar", "-xzf", filePath, "-C", destDir], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`tar extraction failed: ${stderr}`);
    }
  } else if (lower.endsWith(".zip")) {
    const proc = Bun.spawn(["unzip", "-o", filePath, "-d", destDir], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`unzip extraction failed: ${stderr}`);
    }
  } else {
    throw new Error(`Unsupported archive format: ${filePath}`);
  }
}

/** Generate a temp directory path for extraction. */
export function getTempDir(baseDir: string, id: string): string {
  return join(baseDir, "temp", id);
}
