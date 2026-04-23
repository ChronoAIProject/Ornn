/**
 * Minimal GitHub public-repo source fetcher for the from-source skill
 * generator. Not a general-purpose GitHub client — purpose-built to feed
 * a few route files into the LLM context window.
 *
 * Public GitHub API, unauthenticated. Rate limit: 60 req / hour / IP.
 * Fine for individual use; production at scale needs a token-backed
 * client.
 *
 * @module domains/skills/generation/githubFetcher
 */

import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "githubFetcher" });

export interface FetchOptions {
  /** Default: tries common route-folder names. */
  readonly path?: string;
  /** Max files to pull. Default 8. LLM context budget keeps this low. */
  readonly maxFiles?: number;
  /** Max bytes per file. Default 16 KiB. Prevents one giant file blowing context. */
  readonly maxBytesPerFile?: number;
}

export interface FetchedBundle {
  /** Concatenated source, each chunk separated by a `// FILE: <path>` marker. */
  readonly code: string;
  /** Files that were included in the bundle. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: number }>;
  /** Detected framework hint ("express" / "fastapi" / ...), or undefined. */
  readonly frameworkHint?: string;
  /** Original owner/repo/ref for audit. */
  readonly source: { readonly owner: string; readonly repo: string; readonly ref: string };
}

interface ParsedRepoUrl {
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
  readonly subpath: string | undefined;
}

/** Parse `https://github.com/{owner}/{repo}[/tree/{ref}[/path/...]]` into pieces. */
export function parseRepoUrl(url: string): ParsedRepoUrl | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== "github.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, "");

  // /tree/<ref>/<subpath...> or just /<owner>/<repo>
  if (parts.length >= 4 && parts[2] === "tree") {
    const ref = parts[3]!;
    const subpath = parts.slice(4).join("/") || undefined;
    return { owner, repo, ref, subpath };
  }
  return { owner, repo, ref: "HEAD", subpath: undefined };
}

const LIKELY_ROUTE_PATHS = [
  "src/routes",
  "src/controllers",
  "src/handlers",
  "src/api",
  "src/app/api",
  "routes",
  "controllers",
  "app",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".py", ".go", ".java", ".rb", ".rs"]);

interface GithubContentEntry {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "dir" | "symlink" | string;
  readonly size: number;
  readonly download_url: string | null;
}

/**
 * Fetch a small bundle of source files from a public GitHub repo.
 * Returns the concatenated source + metadata, or throws with a
 * user-safe message when the repo/path can't be resolved.
 */
export async function fetchGithubSourceBundle(
  url: string,
  options: FetchOptions = {},
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<FetchedBundle> {
  const parsed = parseRepoUrl(url);
  if (!parsed) {
    throw new Error(`Not a recognized GitHub URL: ${url}`);
  }

  const maxFiles = options.maxFiles ?? 8;
  const maxBytesPerFile = options.maxBytesPerFile ?? 16 * 1024;
  const candidatePaths = options.path
    ? [options.path]
    : parsed.subpath
      ? [parsed.subpath]
      : LIKELY_ROUTE_PATHS;

  let chosenPath: string | null = null;
  let listing: GithubContentEntry[] = [];
  for (const path of candidatePaths) {
    const entries = await listContents(parsed, path, fetchImpl);
    if (entries && entries.length > 0) {
      chosenPath = path;
      listing = entries;
      break;
    }
  }
  if (!chosenPath) {
    // Fallback: try the repo root
    const root = await listContents(parsed, "", fetchImpl);
    if (root && root.length > 0) {
      chosenPath = "";
      listing = root;
    }
  }
  if (!chosenPath && listing.length === 0) {
    throw new Error("Could not locate any source files in the repo (tried common route folders + root)");
  }

  // Filter to source files, sort by size ascending so smaller files (more likely
  // to be route definitions than bundles) come first.
  const sources = listing
    .filter((e) => e.type === "file" && hasSourceExt(e.name) && e.size > 0)
    .sort((a, b) => a.size - b.size)
    .slice(0, maxFiles);

  if (sources.length === 0) {
    throw new Error(`No recognized source files under ${chosenPath || "/"}`);
  }

  const chunks: string[] = [];
  const files: Array<{ path: string; bytes: number }> = [];
  for (const entry of sources) {
    if (!entry.download_url) continue;
    const res = await fetchImpl(entry.download_url);
    if (!res.ok) {
      logger.warn({ path: entry.path, status: res.status }, "Failed to fetch file");
      continue;
    }
    let text = await res.text();
    if (text.length > maxBytesPerFile) {
      text = text.slice(0, maxBytesPerFile) + "\n// ... truncated\n";
    }
    chunks.push(`// FILE: ${entry.path}\n${text}`);
    files.push({ path: entry.path, bytes: text.length });
  }

  const code = chunks.join("\n\n");
  const frameworkHint = detectFrameworkHint(code);

  logger.info(
    {
      owner: parsed.owner,
      repo: parsed.repo,
      ref: parsed.ref,
      path: chosenPath,
      fileCount: files.length,
      totalBytes: code.length,
      frameworkHint,
    },
    "Fetched GitHub source bundle",
  );

  return {
    code,
    files,
    frameworkHint,
    source: { owner: parsed.owner, repo: parsed.repo, ref: parsed.ref },
  };
}

async function listContents(
  parsed: ParsedRepoUrl,
  path: string,
  fetchImpl: typeof fetch,
): Promise<GithubContentEntry[] | null> {
  const encodedPath = path ? `/${encodeURI(path)}` : "";
  const refQuery = parsed.ref && parsed.ref !== "HEAD" ? `?ref=${encodeURIComponent(parsed.ref)}` : "";
  const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents${encodedPath}${refQuery}`;
  try {
    const res = await fetchImpl(apiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ornn-api/generate-from-source",
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      logger.warn({ status: res.status, apiUrl }, "GitHub contents API non-OK");
      return null;
    }
    const body = (await res.json()) as GithubContentEntry[] | GithubContentEntry;
    return Array.isArray(body) ? body : [body];
  } catch (err) {
    logger.warn({ err: (err as Error).message, apiUrl }, "GitHub contents fetch failed");
    return null;
  }
}

function hasSourceExt(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return SOURCE_EXTENSIONS.has(name.slice(i).toLowerCase());
}

function detectFrameworkHint(code: string): string | undefined {
  const probes: Array<[RegExp, string]> = [
    [/\bfrom\s+['"]hono['"]/i, "hono"],
    [/require\(['"]express['"]\)|\bfrom\s+['"]express['"]/i, "express"],
    [/\bfrom\s+['"]fastify['"]/i, "fastify"],
    [/\bfrom\s+fastapi\b/i, "fastapi"],
    [/\bfrom\s+flask\b/i, "flask"],
    [/@SpringBootApplication\b|@RequestMapping\b/i, "spring-boot"],
    [/gin\.Default\(\)|gin\.Engine\b/i, "gin"],
    [/\brouter\s*:?=\s*mux\./i, "gorilla-mux"],
  ];
  for (const [re, name] of probes) {
    if (re.test(code)) return name;
  }
  return undefined;
}
