/**
 * Tests for GitHubMirrorClient (#872).
 *
 * The client is the thin REST wrapper over GitHub's Git Data API. Tests
 * swap `globalThis.fetch` for a recording stub and inject a fake
 * `GitHubAppAuth` (returns a fixed token, never touches the network) plus
 * a fixed `resolveTarget`. Each method is checked for: correct HTTP verb +
 * path, request body shape, happy-path SHA extraction, and the error /
 * missing-field surfaces.
 *
 * Coverage:
 *   - getDefaultBranchHead: 200→sha / 404→null / 500→throws
 *   - updateDefaultBranch: PATCH {sha, force:true} + non-ok throws
 *   - createBranchRef: POST refs/heads/<branch>
 *   - getRecursiveTree: happy / truncated→throws / non-ok→throws
 *   - createTree: base_tree set when baseTree given / omitted when not /
 *                 missing sha throws
 *   - createBlob: base64-encoded body / missing sha throws
 *   - createCommit: {message, tree, parents} / missing sha throws
 *   - createAnnotatedTag: tag→ref two-step / non-ok at either step throws
 *   - getCommitTreeSha: tree.sha / missing tree throws
 *   - api() shared headers + Content-Type only when a body is present
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { GitHubMirrorClient } from "./githubMirrorClient";
import type { GitHubAppAuth } from "./githubAppAuth";

const OWNER = "ChronoAIProject";
const REPO = "ornn-skills";
const BRANCH = "main";
const TOKEN = "tok";

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

const originalFetch = globalThis.fetch;
let captured: CapturedRequest[];
let fetchHandler: () => Promise<Response> | Response;

beforeEach(() => {
  captured = [];
  fetchHandler = () => new Response("no handler", { status: 500 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    captured.push({ url, init });
    return fetchHandler();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeClient(): GitHubMirrorClient {
  const fakeAuth = {
    getInstallationToken: async () => TOKEN,
  } as unknown as GitHubAppAuth;
  return new GitHubMirrorClient(fakeAuth, async () => ({
    owner: OWNER,
    repo: REPO,
    defaultBranch: BRANCH,
  }));
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Parse the JSON body the client posted on the Nth captured request. */
function bodyOf(idx: number): Record<string, unknown> {
  const raw = captured[idx]!.init?.body;
  return JSON.parse(String(raw)) as Record<string, unknown>;
}

function headersOf(idx: number): Record<string, string> {
  return captured[idx]!.init?.headers as Record<string, string>;
}

describe("GitHubMirrorClient — Refs", () => {
  it("getDefaultBranchHead returns the SHA on 200", async () => {
    fetchHandler = () => json({ object: { sha: "abc123" } });
    const sha = await makeClient().getDefaultBranchHead();
    expect(sha).toBe("abc123");
    expect(captured[0]!.url).toBe(
      `https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`,
    );
    expect(captured[0]!.init?.method).toBe("GET");
  });

  it("getDefaultBranchHead returns null on 404 (fresh empty repo)", async () => {
    fetchHandler = () => new Response("not found", { status: 404 });
    const sha = await makeClient().getDefaultBranchHead();
    expect(sha).toBeNull();
  });

  it("getDefaultBranchHead throws on 500", async () => {
    fetchHandler = () => new Response("boom", { status: 500 });
    await expect(makeClient().getDefaultBranchHead()).rejects.toThrow(/500/);
  });

  it("updateDefaultBranch PATCHes {sha, force:true}", async () => {
    fetchHandler = () => json({});
    await makeClient().updateDefaultBranch("deadbeef");
    expect(captured[0]!.url).toBe(
      `https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`,
    );
    expect(captured[0]!.init?.method).toBe("PATCH");
    expect(bodyOf(0)).toEqual({ sha: "deadbeef", force: true });
  });

  it("updateDefaultBranch throws when non-ok", async () => {
    fetchHandler = () => new Response("nope", { status: 422 });
    await expect(makeClient().updateDefaultBranch("x")).rejects.toThrow(/422/);
  });

  it("createBranchRef POSTs refs/heads/<branch>", async () => {
    fetchHandler = () => json({});
    await makeClient().createBranchRef("seedsha");
    expect(captured[0]!.url).toBe(
      `https://api.github.com/repos/${OWNER}/${REPO}/git/refs`,
    );
    expect(captured[0]!.init?.method).toBe("POST");
    expect(bodyOf(0)).toEqual({ ref: `refs/heads/${BRANCH}`, sha: "seedsha" });
  });
});

describe("GitHubMirrorClient — Trees", () => {
  it("getRecursiveTree returns the entries on the happy path", async () => {
    const tree = [
      { path: "a.txt", mode: "100644" as const, type: "blob" as const, sha: "s1" },
    ];
    fetchHandler = () => json({ tree, truncated: false });
    const out = await makeClient().getRecursiveTree("treesha");
    expect(out).toEqual(tree);
    expect(captured[0]!.url).toBe(
      `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/treesha?recursive=1`,
    );
  });

  it("getRecursiveTree throws when GitHub flags the tree truncated", async () => {
    fetchHandler = () => json({ tree: [], truncated: true });
    await expect(makeClient().getRecursiveTree("big")).rejects.toThrow(
      /truncated|100k|exceeded/i,
    );
  });

  it("getRecursiveTree throws on non-ok", async () => {
    fetchHandler = () => new Response("x", { status: 404 });
    await expect(makeClient().getRecursiveTree("missing")).rejects.toThrow(/404/);
  });

  it("createTree sets base_tree when baseTree is provided", async () => {
    fetchHandler = () => json({ sha: "newtree" });
    const entries = [
      { path: "f", mode: "100644" as const, type: "blob" as const, sha: "b1" },
    ];
    const sha = await makeClient().createTree(entries, "basesha");
    expect(sha).toBe("newtree");
    const body = bodyOf(0);
    expect(body.base_tree).toBe("basesha");
    expect(body.tree).toEqual(entries);
  });

  it("createTree omits base_tree when no base is provided", async () => {
    fetchHandler = () => json({ sha: "newtree" });
    await makeClient().createTree([], null);
    const body = bodyOf(0);
    expect("base_tree" in body).toBe(false);
  });

  it("createTree throws when the response has no sha", async () => {
    fetchHandler = () => json({});
    await expect(makeClient().createTree([], null)).rejects.toThrow(/no SHA/);
  });
});

describe("GitHubMirrorClient — Blobs", () => {
  it("createBlob base64-encodes the content body", async () => {
    fetchHandler = () => json({ sha: "blobsha" });
    const sha = await makeClient().createBlob("hello world");
    expect(sha).toBe("blobsha");
    const body = bodyOf(0);
    expect(body.encoding).toBe("base64");
    expect(body.content).toBe(Buffer.from("hello world", "utf-8").toString("base64"));
  });

  it("createBlob throws when the response has no sha", async () => {
    fetchHandler = () => json({});
    await expect(makeClient().createBlob("x")).rejects.toThrow(/no SHA/);
  });
});

describe("GitHubMirrorClient — Commits + tags", () => {
  it("createCommit POSTs {message, tree, parents}", async () => {
    fetchHandler = () => json({ sha: "commitsha" });
    const sha = await makeClient().createCommit({
      message: "sync",
      treeSha: "t1",
      parents: ["p1"],
    });
    expect(sha).toBe("commitsha");
    expect(bodyOf(0)).toEqual({ message: "sync", tree: "t1", parents: ["p1"] });
  });

  it("createCommit throws when the response has no sha", async () => {
    fetchHandler = () => json({});
    await expect(
      makeClient().createCommit({ message: "m", treeSha: "t", parents: [] }),
    ).rejects.toThrow(/no SHA/);
  });

  it("createAnnotatedTag creates the tag object then the ref (two-step)", async () => {
    let call = 0;
    fetchHandler = () => {
      call += 1;
      return call === 1 ? json({ sha: "tagsha" }) : json({});
    };
    await makeClient().createAnnotatedTag({
      tagName: "sync-2026",
      message: "snapshot",
      objectSha: "commitsha",
    });
    expect(captured.length).toBe(2);
    // Step 1: create tag object.
    expect(captured[0]!.url).toBe(
      `https://api.github.com/repos/${OWNER}/${REPO}/git/tags`,
    );
    expect(bodyOf(0)).toEqual({
      tag: "sync-2026",
      message: "snapshot",
      object: "commitsha",
      type: "commit",
    });
    // Step 2: point a tag ref at the tag object's sha.
    expect(captured[1]!.url).toBe(
      `https://api.github.com/repos/${OWNER}/${REPO}/git/refs`,
    );
    expect(bodyOf(1)).toEqual({ ref: "refs/tags/sync-2026", sha: "tagsha" });
  });

  it("createAnnotatedTag throws when the tag-object step fails", async () => {
    fetchHandler = () => new Response("bad", { status: 422 });
    await expect(
      makeClient().createAnnotatedTag({ tagName: "t", message: "m", objectSha: "o" }),
    ).rejects.toThrow(/422/);
    expect(captured.length).toBe(1);
  });

  it("createAnnotatedTag throws when the ref step fails", async () => {
    let call = 0;
    fetchHandler = () => {
      call += 1;
      return call === 1 ? json({ sha: "tagsha" }) : new Response("dup", { status: 422 });
    };
    await expect(
      makeClient().createAnnotatedTag({ tagName: "t", message: "m", objectSha: "o" }),
    ).rejects.toThrow(/422/);
    expect(captured.length).toBe(2);
  });

  it("getCommitTreeSha returns tree.sha", async () => {
    fetchHandler = () => json({ tree: { sha: "treesha" } });
    const sha = await makeClient().getCommitTreeSha("commitsha");
    expect(sha).toBe("treesha");
    expect(captured[0]!.url).toBe(
      `https://api.github.com/repos/${OWNER}/${REPO}/git/commits/commitsha`,
    );
  });

  it("getCommitTreeSha throws when the commit has no tree", async () => {
    fetchHandler = () => json({});
    await expect(makeClient().getCommitTreeSha("c")).rejects.toThrow(/no tree/);
  });
});

describe("GitHubMirrorClient — api() headers", () => {
  it("stamps the shared GitHub headers + bearer token on every call", async () => {
    fetchHandler = () => json({ object: { sha: "x" } });
    await makeClient().getDefaultBranchHead();
    const h = headersOf(0);
    expect(h.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(h.Accept).toBe("application/vnd.github+json");
    expect(h["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(h["User-Agent"]).toBe("ornn-api-mirror");
  });

  it("sets Content-Type only when a request body is present", async () => {
    // GET (no body) → no Content-Type.
    fetchHandler = () => json({ object: { sha: "x" } });
    await makeClient().getDefaultBranchHead();
    expect(headersOf(0)["Content-Type"]).toBeUndefined();

    // POST (with body) → Content-Type: application/json.
    captured = [];
    fetchHandler = () => json({ sha: "s" });
    await makeClient().createBlob("data");
    expect(headersOf(0)["Content-Type"]).toBe("application/json");
  });
});
