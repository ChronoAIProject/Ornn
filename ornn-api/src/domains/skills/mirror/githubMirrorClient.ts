/**
 * Thin GitHub REST client for the mirror service.
 *
 * Wraps the four Git Data API surfaces we use:
 *   - Refs (read default-branch HEAD, update it, create tags)
 *   - Trees (read recursively, build new ones)
 *   - Blobs (create file blobs)
 *   - Commits (create + tag annotated)
 *
 * Every call goes out with a fresh installation token from
 * `GitHubAppAuth`. The client is intentionally stateless beyond auth —
 * one instance can serve many concurrent sync runs.
 *
 * Each method maps 1:1 to a GitHub REST endpoint so callers can read
 * the official docs without a translation layer in their head.
 *
 * @module domains/skills/mirror/githubMirrorClient
 */

import { createLogger } from "../../../shared/logger";
import { GitHubAppAuth } from "./githubAppAuth";

const logger = createLogger("githubMirrorClient");

export interface GitHubMirrorTarget {
  owner: string;
  repo: string;
  /** Typically `main`. */
  defaultBranch: string;
}

/** Single entry as returned/accepted by the Trees API. */
export interface TreeEntry {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000" | "120000";
  type: "blob" | "tree" | "commit";
  sha?: string;
  /** Used as an alternative to `sha` when posting inline contents. */
  content?: string;
}

/**
 * Resolves the current repo coordinates. Called at the start of every
 * outbound API request so a runtime admin patch (`POST /api/v1/github
 * /repo`) takes effect on the next operation without a redeploy.
 *
 * Backed by `PlatformSettingsService.getGithubMirrorRepo()` in
 * production, which itself caches for 30s on top of the DB doc.
 */
export type GitHubMirrorTargetResolver = () => Promise<GitHubMirrorTarget>;

export class GitHubMirrorClient {
  private static readonly BASE = "https://api.github.com";

  constructor(
    private readonly auth: GitHubAppAuth,
    private readonly resolveTarget: GitHubMirrorTargetResolver,
  ) {}

  // ────────────────────────── Refs ──────────────────────────

  /**
   * Returns the SHA of the latest commit on the default branch, or
   * `null` when the branch doesn't exist yet (fresh, empty mirror
   * repo). Callers handle the null by bootstrapping a first commit.
   */
  async getDefaultBranchHead(): Promise<string | null> {
    const t = await this.resolveTarget();
    const path = `/repos/${t.owner}/${t.repo}/git/ref/heads/${t.defaultBranch}`;
    const resp = await this.api("GET", path);
    if (resp.status === 404) return null;
    if (!resp.ok) await throwApiError(resp, "getDefaultBranchHead");
    const json = (await resp.json()) as { object?: { sha?: string } };
    return json.object?.sha ?? null;
  }

  /**
   * Force-update default branch to the given commit SHA. Force is
   * load-bearing: the mirror is canonical-from-Ornn, so we never
   * rebase / merge; we always replace the branch tip. Recipients
   * should re-clone, not pull.
   */
  async updateDefaultBranch(commitSha: string): Promise<void> {
    const t = await this.resolveTarget();
    const path = `/repos/${t.owner}/${t.repo}/git/refs/heads/${t.defaultBranch}`;
    const resp = await this.api("PATCH", path, { sha: commitSha, force: true });
    if (!resp.ok) await throwApiError(resp, "updateDefaultBranch");
  }

  /** Create a fresh ref (used to seed `main` on a never-pushed-to repo). */
  async createBranchRef(commitSha: string): Promise<void> {
    const t = await this.resolveTarget();
    const path = `/repos/${t.owner}/${t.repo}/git/refs`;
    const resp = await this.api("POST", path, {
      ref: `refs/heads/${t.defaultBranch}`,
      sha: commitSha,
    });
    if (!resp.ok) await throwApiError(resp, "createBranchRef");
  }

  // ────────────────────────── Trees ──────────────────────────

  /**
   * Read the full file inventory for a commit's tree. Recursive=1 so
   * we get blobs nested under multiple subdirs in one call. The
   * returned `truncated` flag is real for very large repos (>100k
   * entries) — we error in that case rather than silently mirroring
   * a partial view.
   */
  async getRecursiveTree(treeSha: string): Promise<TreeEntry[]> {
    const t = await this.resolveTarget();
    const path = `/repos/${t.owner}/${t.repo}/git/trees/${treeSha}?recursive=1`;
    const resp = await this.api("GET", path);
    if (!resp.ok) await throwApiError(resp, "getRecursiveTree");
    const json = (await resp.json()) as { tree?: TreeEntry[]; truncated?: boolean };
    if (json.truncated) {
      throw new Error(
        `Mirror tree exceeded GitHub's 100k-entry recursive read cap (sha=${treeSha}). ` +
          `Split the mirror repo before continuing.`,
      );
    }
    return json.tree ?? [];
  }

  /**
   * Build a new tree from a list of entries. When `baseTree` is set,
   * entries are diffed against that base — entries omitted survive
   * unchanged, and an entry with `sha: null` deletes the path. When
   * unset, the list is treated as the full tree (good for from-scratch
   * builds in reconciliation).
   */
  async createTree(entries: TreeEntry[], baseTree: string | null = null): Promise<string> {
    const t = await this.resolveTarget();
    const path = `/repos/${t.owner}/${t.repo}/git/trees`;
    const body: Record<string, unknown> = { tree: entries };
    if (baseTree) body.base_tree = baseTree;
    const resp = await this.api("POST", path, body);
    if (!resp.ok) await throwApiError(resp, "createTree");
    const json = (await resp.json()) as { sha?: string };
    if (!json.sha) throw new Error("createTree returned no SHA");
    return json.sha;
  }

  // ────────────────────────── Blobs ──────────────────────────

  /**
   * Upload a UTF-8 file payload as a blob, return its SHA. Encoded as
   * base64 to survive non-UTF-8 byte sequences (binary skill assets).
   */
  async createBlob(content: string): Promise<string> {
    const t = await this.resolveTarget();
    const path = `/repos/${t.owner}/${t.repo}/git/blobs`;
    const body = { content: Buffer.from(content, "utf-8").toString("base64"), encoding: "base64" };
    const resp = await this.api("POST", path, body);
    if (!resp.ok) await throwApiError(resp, "createBlob");
    const json = (await resp.json()) as { sha?: string };
    if (!json.sha) throw new Error("createBlob returned no SHA");
    return json.sha;
  }

  // ────────────────────────── Commits + tags ──────────────────────────

  async createCommit(opts: {
    message: string;
    treeSha: string;
    /** Empty array seeds an initial commit on a brand-new repo. */
    parents: string[];
  }): Promise<string> {
    const t = await this.resolveTarget();
    const path = `/repos/${t.owner}/${t.repo}/git/commits`;
    const resp = await this.api("POST", path, {
      message: opts.message,
      tree: opts.treeSha,
      parents: opts.parents,
    });
    if (!resp.ok) await throwApiError(resp, "createCommit");
    const json = (await resp.json()) as { sha?: string };
    if (!json.sha) throw new Error("createCommit returned no SHA");
    return json.sha;
  }

  /**
   * Annotated tag pointing at `objectSha`. Two-step: create the tag
   * object, then create a `refs/tags/<name>` ref pointing at it.
   */
  async createAnnotatedTag(opts: {
    tagName: string;
    message: string;
    objectSha: string;
  }): Promise<void> {
    const t = await this.resolveTarget();
    const tagPath = `/repos/${t.owner}/${t.repo}/git/tags`;
    const tagResp = await this.api("POST", tagPath, {
      tag: opts.tagName,
      message: opts.message,
      object: opts.objectSha,
      type: "commit",
    });
    if (!tagResp.ok) await throwApiError(tagResp, "createAnnotatedTag");
    const tagJson = (await tagResp.json()) as { sha?: string };
    if (!tagJson.sha) throw new Error("createAnnotatedTag returned no SHA");

    const refPath = `/repos/${t.owner}/${t.repo}/git/refs`;
    const refResp = await this.api("POST", refPath, {
      ref: `refs/tags/${opts.tagName}`,
      sha: tagJson.sha,
    });
    if (!refResp.ok) await throwApiError(refResp, "createAnnotatedTagRef");
  }

  /**
   * Read a commit's tree SHA — needed to base the next tree write off
   * the previous commit.
   */
  async getCommitTreeSha(commitSha: string): Promise<string> {
    const t = await this.resolveTarget();
    const path = `/repos/${t.owner}/${t.repo}/git/commits/${commitSha}`;
    const resp = await this.api("GET", path);
    if (!resp.ok) await throwApiError(resp, "getCommitTreeSha");
    const json = (await resp.json()) as { tree?: { sha?: string } };
    if (!json.tree?.sha) throw new Error(`Commit ${commitSha} has no tree`);
    return json.tree.sha;
  }

  // ────────────────────────── Internals ──────────────────────────

  private async api(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const token = await this.auth.getInstallationToken();
    const url = `${GitHubMirrorClient.BASE}${path}`;
    // exactOptionalPropertyTypes (#657): only stamp `body` when set so
    // RequestInit doesn't receive a `body: undefined` (its body field
    // is `BodyInit | null`, not optional-undefined).
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ornn-api-mirror",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    const resp = await fetch(url, init);
    logger.debug({ method, path, status: resp.status }, "github api call");
    return resp;
  }
}

async function throwApiError(resp: Response, op: string): Promise<never> {
  const body = await resp.text().catch(() => "");
  logger.error(
    { op, status: resp.status, body: body.slice(0, 500) },
    "GitHub API call failed",
  );
  throw new Error(`GitHub ${op} failed (${resp.status}): ${body.slice(0, 200)}`);
}
