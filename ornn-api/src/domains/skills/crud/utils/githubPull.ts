/**
 * Pull a skill package directly from a public GitHub repo.
 *
 * The SKILL.md + supporting files live at `{owner}/{name}:{ref}/{path}`.
 * We resolve the ref to a commit SHA for audit, walk the directory via
 * the contents API, fetch each file's raw bytes, and build a ZIP in the
 * shape the existing upload pipeline expects (skill-root/SKILL.md, etc.).
 *
 * Constraints:
 *   - public repos only
 *   - single directory, recursive (enumerates via contents API)
 *   - max 200 files / 10 MiB total to keep the pull bounded
 *
 * Auth (#1175): every `api.github.com` request may carry an optional
 * `Authorization: Bearer <token>`. The token is a service-account
 * credential used ONLY to lift the unauthenticated 60-req/hr-per-IP rate
 * limit to the authenticated 5,000/hr (with free `304`s) — it grants no
 * access beyond public content. Raw file downloads (`download_url`, served
 * from `raw.githubusercontent.com`) stay unauthenticated: they're a
 * different host with a separate budget and need no credential.
 *
 * @module domains/skills/crud/utils/githubPull
 */

import JSZip from "jszip";
import { createLogger } from "../../../../shared/logger";
import { hasUnsafeSegment } from "../../../../shared/githubNaming";
const logger = createLogger("githubSkillPull");

const GITHUB_USER_AGENT = "ornn-api/skills-github-pull";

/**
 * Build headers for an `api.github.com` request. Adds `Authorization` only
 * when a non-empty token is supplied — so the same code path serves both
 * authenticated (rate-limit-lifted) and anonymous reads.
 */
export function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": GITHUB_USER_AGENT,
  };
  if (typeof token === "string" && token.length > 0) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Thrown when a repo/ref genuinely doesn't exist (404 on both the branch
 * and tag ref lookups). A typed error so the drift checker can map it to a
 * `broken` state without coupling this low-level util to the HTTP-layer
 * `AppError`.
 */
export class GitHubSourceNotFoundError extends Error {
  constructor(
    public readonly repo: string,
    public readonly ref: string,
  ) {
    super(`GitHub ref '${ref}' not found in ${repo}`);
    this.name = "GitHubSourceNotFoundError";
  }
}

export interface GitHubPullInput {
  /** `owner/name`. */
  readonly repo: string;
  // Optional fields widen to `T | undefined` so callers with optional
  // input values fit under exactOptionalPropertyTypes (#657).
  /** Branch, tag, or commit SHA. Defaults to the repo's default branch. */
  readonly ref?: string | undefined;
  /** Directory inside the repo containing SKILL.md. `""` = repo root. */
  readonly path?: string | undefined;
  /** Max files to pull. Safety cap. Default 200. */
  readonly maxFiles?: number | undefined;
  /** Max total bytes. Safety cap. Default 10 MiB. */
  readonly maxTotalBytes?: number | undefined;
  /**
   * Service-account token used to authenticate `api.github.com` reads and
   * lift the rate limit. Absent ⇒ anonymous (rate-limited) reads. Never
   * sent to raw file downloads.
   */
  readonly token?: string | undefined;
}

/** Options for the cheap HEAD-SHA drift probe. */
export interface RefHeadProbeInput {
  /** Auth token — see {@link authHeaders}. */
  readonly token?: string | undefined;
  /** Prior ETag for a conditional request; a matching `304` is free. */
  readonly etag?: string | undefined;
}

/** Result of {@link resolveRefHeadSha}. */
export interface RefHeadProbeResult {
  /** Branch/tag HEAD commit SHA. Absent only when `notModified` is true. */
  readonly sha?: string | undefined;
  /** Fresh ETag to persist for the next conditional probe. */
  readonly etag?: string | undefined;
  /** True when the server answered `304 Not Modified` (nothing changed). */
  readonly notModified: boolean;
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
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed) ||
    hasUnsafeSegment(trimmed)
  ) {
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
export function parseGithubUrl(
  rawUrl: string,
): { repo: string; ref?: string | undefined; path?: string | undefined } {
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
  const resolvedCommitSha = await resolveRefToSha(repo, refInput, fetchImpl, input.token);

  // Walk the target directory recursively.
  const allFiles: GitHubContentEntry[] = [];
  await walkContents(repo, resolvedCommitSha, path, fetchImpl, allFiles, input.token);

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

/** Encode a slash-bearing ref (e.g. `feature/x`) segment-by-segment so the
 * git-ref path stays intact instead of collapsing `/` into `%2F`. */
function encodeRefPath(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}

/**
 * Cheap drift probe: resolve a branch/tag HEAD to its commit SHA using the
 * lightweight `git/ref` endpoint (~200-byte body vs. the multi-KB commits
 * API), with optional ETag conditional support.
 *
 * - A 40-hex `ref` is a pinned commit — it can never drift, so we return it
 *   immediately with NO network call.
 * - Branches resolve via `git/ref/heads/<branch>`. On a `404` we fall back
 *   to `git/ref/tags/<tag>` before declaring the source missing.
 * - A stored `etag` yields a `304 Not Modified` when nothing changed, which
 *   (for authenticated requests) does not count against the rate limit.
 *
 * Caveat: for an *annotated* tag, `object.sha` is the tag object SHA, not
 * the underlying commit — so a tag-sourced skill's drift comparison is
 * best-effort. Branches and pinned SHAs (the common cases) compare exactly;
 * the full-pull path (`resolveRefToSha`) remains the source of truth.
 */
export async function resolveRefHeadSha(
  repo: string,
  ref: string,
  opts: RefHeadProbeInput = {},
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<RefHeadProbeResult> {
  const normalizedRepo = normalizeRepoIdentifier(repo);
  const trimmedRef = ref.trim();
  if (/^[0-9a-f]{40}$/i.test(trimmedRef)) {
    // Pinned commit SHA — immutable, no HTTP needed.
    return { sha: trimmedRef, notModified: false };
  }

  const headers = authHeaders(opts.token);
  if (typeof opts.etag === "string" && opts.etag.length > 0) {
    headers["If-None-Match"] = opts.etag;
  }

  const probe = async (
    refType: "heads" | "tags",
  ): Promise<RefHeadProbeResult | "not-found"> => {
    const url = `https://api.github.com/repos/${normalizedRepo}/git/ref/${refType}/${encodeRefPath(trimmedRef)}`;
    const res = await fetchImpl(url, { headers });
    if (res.status === 304) return { notModified: true };
    if (res.status === 404) return "not-found";
    if (!res.ok) {
      throw new Error(
        `GitHub git/ref API returned ${res.status} for ${normalizedRepo}@${trimmedRef}`,
      );
    }
    const body = (await res.json()) as { object?: { sha?: string } };
    const sha = body.object?.sha;
    if (!sha) {
      throw new Error(
        `GitHub git/ref API returned no object SHA for ${normalizedRepo}@${trimmedRef}`,
      );
    }
    return { sha, etag: res.headers.get("etag") ?? undefined, notModified: false };
  };

  const asBranch = await probe("heads");
  if (asBranch !== "not-found") return asBranch;
  const asTag = await probe("tags");
  if (asTag !== "not-found") return asTag;
  throw new GitHubSourceNotFoundError(normalizedRepo, trimmedRef);
}

async function resolveRefToSha(
  repo: string,
  ref: string,
  fetchImpl: typeof fetch,
  token?: string,
): Promise<string> {
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`;
  const res = await fetchImpl(url, { headers: authHeaders(token) });
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
  token?: string,
): Promise<void> {
  const encodedPath = path ? `/${encodeURI(path)}` : "";
  const url = `https://api.github.com/repos/${repo}/contents${encodedPath}?ref=${encodeURIComponent(ref)}`;
  const res = await fetchImpl(url, { headers: authHeaders(token) });
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
      await walkContents(repo, ref, entry.path, fetchImpl, out, token);
    }
    // symlinks, submodules → skip
  }
}
