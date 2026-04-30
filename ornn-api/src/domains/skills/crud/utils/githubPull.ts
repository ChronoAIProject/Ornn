/**
 * Pull a skill package directly from a public GitHub repo.
 *
 * The SKILL.md + supporting files live at `{owner}/{name}:{ref}/{path}`.
 * We resolve the ref to a commit SHA for audit, walk the directory via
 * the contents API, fetch each file's raw bytes, and build a ZIP in the
 * shape the existing upload pipeline expects (skill-root/SKILL.md, etc.).
 *
 * MVP constraints:
 *   - public repos only (no auth header)
 *   - single directory, recursive (enumerates via contents API)
 *   - max 200 files / 10 MiB total to keep the pull bounded
 *
 * @module domains/skills/crud/utils/githubPull
 */

import JSZip from "jszip";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "githubSkillPull" });

export interface GitHubPullInput {
  /** `owner/name`. */
  readonly repo: string;
  /** Branch, tag, or commit SHA. Defaults to the repo's default branch. */
  readonly ref?: string;
  /** Directory inside the repo containing SKILL.md. `""` = repo root. */
  readonly path?: string;
  /** Max files to pull. Safety cap. Default 200. */
  readonly maxFiles?: number;
  /** Max total bytes. Safety cap. Default 10 MiB. */
  readonly maxTotalBytes?: number;
}

export interface GitHubPullResult {
  /** Packaged ZIP ready to hand to createSkill / updateSkill. */
  readonly zipBuffer: Uint8Array;
  /** Actual commit SHA that was fetched (ref resolved at pull time). */
  readonly resolvedCommitSha: string;
  /** Manifest of files included (path + bytes). Useful for logs + tests. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: number }>;
  /** Normalized inputs, echoed back for persistence convenience. */
  readonly source: {
    readonly repo: string;
    readonly ref: string;
    readonly path: string;
  };
}

interface GitHubContentEntry {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "dir" | "symlink" | string;
  readonly size: number;
  readonly sha: string;
  readonly download_url: string | null;
}

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** Validates `owner/name` and strips any trailing whitespace. */
export function normalizeRepoIdentifier(repo: string): string {
  const trimmed = repo.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new Error(
      `Invalid GitHub repo identifier '${repo}'. Expected 'owner/name'.`,
    );
  }
  return trimmed;
}

/** Normalizes a `path` argument: strips leading/trailing slashes, rejects traversal. */
export function normalizePath(path: string | undefined): string {
  const raw = (path ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (raw.split("/").some((seg) => seg === ".." || seg === ".")) {
    throw new Error(`Invalid path '${path}' — no traversal or current-dir segments`);
  }
  return raw;
}

/**
 * Parse a GitHub URL into `{ repo, ref, path }`. Accepts the canonical
 * tree-link form a user copies from a folder page:
 *
 *   https://github.com/<owner>/<repo>/tree/<ref>/<sub/dir/path>
 *   https://github.com/<owner>/<repo>/tree/<ref>
 *   https://github.com/<owner>/<repo>             (no tree, no ref → repo root)
 *
 * Rejects `blob/` URLs (they point at a single file, not a directory) and
 * any URL that isn't on `github.com`. Branch names with slashes (e.g.
 * `feature/foo-bar`) are NOT supported because the URL alone is ambiguous
 * — `tree/feature/foo-bar/skills/x` could mean ref=feature/foo-bar
 * path=skills/x OR ref=feature path=foo-bar/skills/x. The user can fall
 * back to the explicit `{ repo, ref, path }` form for those.
 */
export function parseGithubUrl(rawUrl: string): { repo: string; ref?: string; path?: string } {
  const url = rawUrl.trim();
  if (!url) throw new Error("GitHub URL is empty");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid GitHub URL '${rawUrl}'`);
  }
  if (parsed.host !== "github.com" && parsed.host !== "www.github.com") {
    throw new Error(`Expected a github.com URL, got '${parsed.host}'`);
  }

  // Drop leading slash, split, drop trailing empty segment ("/foo/bar/" → ["foo","bar"]).
  const segments = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error("GitHub URL must include both <owner> and <repo>");
  }

  const [owner, repoName, tree, ...rest] = segments;
  const repo = `${owner}/${repoName}`;
  normalizeRepoIdentifier(repo); // throws on invalid characters

  // Bare repo URL: https://github.com/owner/repo (no tree segment).
  if (tree === undefined) {
    return { repo };
  }

  if (tree === "blob") {
    throw new Error(
      "GitHub blob URL points at a single file. Use the folder URL ('/tree/<ref>/<path>') of the skill root instead.",
    );
  }
  if (tree !== "tree") {
    throw new Error(
      `Unsupported GitHub URL shape: '/${tree}/...'. Use the folder URL ('/tree/<ref>/<path>').`,
    );
  }

  if (rest.length === 0) {
    throw new Error("GitHub tree URL is missing the <ref> segment");
  }

  // First segment after `/tree/` is the ref. We accept simple refs only
  // (no slashes) — see the doc comment above. Anything else and we make
  // the user provide repo/ref/path explicitly.
  const ref = rest[0];
  const path = rest.slice(1).join("/");
  return { repo, ref, path: path || undefined };
}

/**
 * Fetch and package a skill from a public GitHub repo.
 */
export async function fetchSkillFromGitHub(
  input: GitHubPullInput,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<GitHubPullResult> {
  const repo = normalizeRepoIdentifier(input.repo);
  const refInput = input.ref?.trim() || "HEAD";
  const path = normalizePath(input.path);
  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_MAX_BYTES;

  // Resolve the ref to a concrete commit SHA for audit logging.
  const resolvedCommitSha = await resolveRefToSha(repo, refInput, fetchImpl);

  // Walk the target directory recursively.
  const allFiles: GitHubContentEntry[] = [];
  await walkContents(repo, resolvedCommitSha, path, fetchImpl, allFiles);

  if (allFiles.length === 0) {
    throw new Error(`No files found under '${path || "/"}' in ${repo}@${refInput}`);
  }
  if (allFiles.length > maxFiles) {
    throw new Error(
      `Refusing to pull: ${allFiles.length} files exceeds the ${maxFiles}-file cap`,
    );
  }

  // Verify a SKILL.md exists at the target directory — every skill package
  // requires one. Existing createSkill will also validate, but failing early
  // here gives a clearer error.
  const skillMdRelative = path ? `${path}/SKILL.md` : "SKILL.md";
  if (!allFiles.some((f) => f.path === skillMdRelative)) {
    throw new Error(`No SKILL.md found at '${skillMdRelative}' in ${repo}@${refInput}`);
  }

  // Build the ZIP with a skill-root folder (the upload pipeline expects
  // `skill-root/SKILL.md`, not flat `SKILL.md`). Use the last path segment
  // as the folder name, or the repo name when pulling from repo root.
  const rootName = path ? path.split("/").pop()! : repo.split("/")[1]!;
  const zip = new JSZip();
  const folder = zip.folder(rootName);
  if (!folder) throw new Error("JSZip: failed to create root folder");

  let totalBytes = 0;
  const manifest: Array<{ path: string; bytes: number }> = [];

  for (const entry of allFiles) {
    if (!entry.download_url || entry.type !== "file") continue;
    const relPath = path ? entry.path.slice(path.length + 1) : entry.path;
    const res = await fetchImpl(entry.download_url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch ${entry.path}: HTTP ${res.status} ${res.statusText}`,
      );
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    totalBytes += buf.byteLength;
    if (totalBytes > maxTotalBytes) {
      throw new Error(
        `Refusing to pull: total bytes ${totalBytes} exceeds the ${maxTotalBytes}-byte cap`,
      );
    }
    folder.file(relPath, buf);
    manifest.push({ path: entry.path, bytes: buf.byteLength });
  }

  const zipBuffer = await zip.generateAsync({ type: "uint8array" });

  logger.info(
    {
      repo,
      ref: refInput,
      resolvedCommitSha,
      path,
      fileCount: manifest.length,
      totalBytes,
      zipBytes: zipBuffer.byteLength,
    },
    "Built skill package from GitHub source",
  );

  return {
    zipBuffer,
    resolvedCommitSha,
    files: manifest,
    source: { repo, ref: refInput, path },
  };
}

async function resolveRefToSha(
  repo: string,
  ref: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`;
  const res = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ornn-api/skills-github-pull",
    },
  });
  if (res.status === 404) {
    throw new Error(`Ref '${ref}' not found in ${repo}`);
  }
  if (!res.ok) {
    throw new Error(
      `GitHub commits API returned ${res.status} for ${repo}@${ref}`,
    );
  }
  const body = (await res.json()) as { sha?: string };
  if (!body.sha) {
    throw new Error(`GitHub commits API returned no SHA for ${repo}@${ref}`);
  }
  return body.sha;
}

async function walkContents(
  repo: string,
  ref: string,
  path: string,
  fetchImpl: typeof fetch,
  out: GitHubContentEntry[],
): Promise<void> {
  const encodedPath = path ? `/${encodeURI(path)}` : "";
  const url = `https://api.github.com/repos/${repo}/contents${encodedPath}?ref=${encodeURIComponent(ref)}`;
  const res = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ornn-api/skills-github-pull",
    },
  });
  if (res.status === 404) {
    // The target path doesn't exist on this ref. Callers decide whether
    // that's acceptable — for the top-level call it isn't; for an empty
    // recursed subdir we just return.
    return;
  }
  if (!res.ok) {
    throw new Error(
      `GitHub contents API returned ${res.status} for ${repo}@${ref}:${path}`,
    );
  }
  const body = (await res.json()) as GitHubContentEntry[] | GitHubContentEntry;
  const entries = Array.isArray(body) ? body : [body];
  for (const entry of entries) {
    if (entry.type === "file") {
      out.push(entry);
    } else if (entry.type === "dir") {
      await walkContents(repo, ref, entry.path, fetchImpl, out);
    }
    // symlinks, submodules → skip
  }
}
