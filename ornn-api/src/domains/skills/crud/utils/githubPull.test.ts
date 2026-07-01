import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import {
  fetchSkillFromGitHub,
  normalizePath,
  normalizeRepoIdentifier,
  parseGithubUrl,
  authHeaders,
  resolveRefHeadSha,
  GitHubSourceNotFoundError,
} from "./githubPull";

/** Records each request's URL + Authorization header, returns caller-chosen responses. */
function recordingFetch(responder: (url: string) => Response): {
  impl: typeof fetch;
  calls: Array<{ url: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return responder(url);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("parseGithubUrl", () => {
  test("extracts repo + ref + path from a /tree/ URL", () => {
    expect(
      parseGithubUrl(
        "https://github.com/ChronoAIProject/Ornn/tree/develop/skills/ornn-agent-manual-cli",
      ),
    ).toEqual({
      repo: "ChronoAIProject/Ornn",
      ref: "develop",
      path: "skills/ornn-agent-manual-cli",
    });
  });

  test("/tree/<ref> with no path → path undefined", () => {
    expect(parseGithubUrl("https://github.com/owner/repo/tree/main")).toEqual({
      repo: "owner/repo",
      ref: "main",
    });
  });

  test("bare repo URL → { repo } only", () => {
    expect(parseGithubUrl("https://github.com/owner/repo")).toEqual({
      repo: "owner/repo",
    });
  });

  test("trailing slash is stripped", () => {
    expect(parseGithubUrl("https://github.com/owner/repo/")).toEqual({
      repo: "owner/repo",
    });
  });

  test("rejects blob URLs (point at file, not folder)", () => {
    expect(() =>
      parseGithubUrl("https://github.com/owner/repo/blob/main/SKILL.md"),
    ).toThrow(/blob URL/);
  });

  test("rejects non-github hosts", () => {
    expect(() => parseGithubUrl("https://gitlab.com/owner/repo/tree/main")).toThrow(
      /github\.com/,
    );
  });

  test("rejects empty URL", () => {
    expect(() => parseGithubUrl("")).toThrow(/empty/);
  });

  test("rejects URLs missing the repo name", () => {
    expect(() => parseGithubUrl("https://github.com/owner")).toThrow(/<owner> and <repo>/);
  });

  test("rejects /tree/ without a ref segment", () => {
    expect(() => parseGithubUrl("https://github.com/owner/repo/tree")).toThrow(
      /missing the <ref>/,
    );
  });

  test("multi-segment path is preserved", () => {
    expect(
      parseGithubUrl("https://github.com/owner/repo/tree/main/a/b/c"),
    ).toEqual({ repo: "owner/repo", ref: "main", path: "a/b/c" });
  });

  test("accepts www.github.com host alias", () => {
    expect(
      parseGithubUrl("https://www.github.com/owner/repo/tree/main/x"),
    ).toEqual({ repo: "owner/repo", ref: "main", path: "x" });
  });
});

describe("normalizeRepoIdentifier", () => {
  test("accepts owner/name", () => {
    expect(normalizeRepoIdentifier("acme/skill")).toBe("acme/skill");
  });
  test("trims whitespace", () => {
    expect(normalizeRepoIdentifier("  acme/skill  ")).toBe("acme/skill");
  });
  test("rejects single segment", () => {
    expect(() => normalizeRepoIdentifier("acme")).toThrow(/Invalid GitHub repo/);
  });
  test("rejects bad chars", () => {
    expect(() => normalizeRepoIdentifier("acme/s kill")).toThrow();
    expect(() => normalizeRepoIdentifier("acme/skill#branch")).toThrow();
  });
  test("rejects path-traversal segments (#818)", () => {
    expect(() => normalizeRepoIdentifier("owner/..")).toThrow(
      /Invalid GitHub repo/,
    );
    expect(() => normalizeRepoIdentifier("../repo")).toThrow(
      /Invalid GitHub repo/,
    );
  });
  test("accepts dotted / dashed repo names", () => {
    expect(normalizeRepoIdentifier("owner/repo.name")).toBe("owner/repo.name");
    expect(normalizeRepoIdentifier("owner/repo-1")).toBe("owner/repo-1");
  });
});

describe("normalizePath", () => {
  test("empty / undefined -> ''", () => {
    expect(normalizePath(undefined)).toBe("");
    expect(normalizePath("")).toBe("");
    expect(normalizePath("/")).toBe("");
  });
  test("strips leading/trailing slashes", () => {
    expect(normalizePath("/skills/pdf/")).toBe("skills/pdf");
  });
  test("rejects .. traversal", () => {
    expect(() => normalizePath("../etc")).toThrow(/traversal/);
    expect(() => normalizePath("foo/../bar")).toThrow(/traversal/);
  });
  test("rejects . segments", () => {
    expect(() => normalizePath("./foo")).toThrow(/traversal/);
  });
});

/** Minimal stub that walks calls like GitHub's contents + raw APIs. */
function buildStubFetch(config: {
  sha: string;
  tree: Record<string, Array<{ name: string; type: "file" | "dir"; size?: number }>>;
  rawFiles: Record<string, string | Uint8Array>;
}): typeof fetch {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const href = typeof input === "string" ? input : input.toString();
    const u = new URL(href);

    // /repos/{owner}/{repo}/commits/{ref}
    if (u.pathname.includes("/commits/")) {
      return new Response(JSON.stringify({ sha: config.sha }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // /repos/{owner}/{repo}/contents[/{path}]
    if (u.pathname.includes("/contents")) {
      const m = u.pathname.match(/\/contents(?:\/(.*))?$/);
      const path = m && m[1] ? decodeURI(m[1]) : "";
      const entries = config.tree[path];
      if (!entries) {
        return new Response("not found", { status: 404 });
      }
      const items = entries.map((e) => {
        const full = path ? `${path}/${e.name}` : e.name;
        return {
          name: e.name,
          path: full,
          type: e.type,
          size: e.size ?? 0,
          sha: "sha-" + full,
          download_url:
            e.type === "file" ? `https://raw.example/${full}` : null,
        };
      });
      return new Response(JSON.stringify(items), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (href.startsWith("https://raw.example/")) {
      const p = href.replace("https://raw.example/", "");
      const content = config.rawFiles[p];
      if (!content) return new Response("raw not found", { status: 404 });
      const body: BodyInit =
        typeof content === "string" ? content : (content.slice().buffer as ArrayBuffer);
      return new Response(body);
    }
    return new Response("unknown", { status: 404 });
  };
  return impl as unknown as typeof fetch;
}

describe("fetchSkillFromGitHub", () => {
  test("pulls SKILL.md + scripts from a subdirectory and returns a zip", async () => {
    const SKILL_MD = `---
name: demo-skill
description: A demo skill pulled from GitHub
---
# Demo

Hello world.
`;
    const fetchMock = buildStubFetch({
      sha: "abc1234def",
      tree: {
        "skills/demo": [
          { name: "SKILL.md", type: "file", size: SKILL_MD.length },
          { name: "scripts", type: "dir" },
        ],
        "skills/demo/scripts": [
          { name: "main.js", type: "file", size: 20 },
        ],
      },
      rawFiles: {
        "skills/demo/SKILL.md": SKILL_MD,
        "skills/demo/scripts/main.js": "console.log('hi');\n",
      },
    });

    const result = await fetchSkillFromGitHub(
      { repo: "acme/skills-repo", ref: "main", path: "skills/demo" },
      fetchMock,
    );
    expect(result.resolvedCommitSha).toBe("abc1234def");
    expect(result.source).toEqual({
      repo: "acme/skills-repo",
      ref: "main",
      path: "skills/demo",
    });
    expect(result.files.map((f) => f.path).sort()).toEqual([
      "skills/demo/SKILL.md",
      "skills/demo/scripts/main.js",
    ]);

    // Verify ZIP contents: root folder is the last path segment.
    const zip = await JSZip.loadAsync(result.zipBuffer);
    expect(Object.keys(zip.files).sort()).toContain("demo/SKILL.md");
    expect(Object.keys(zip.files).sort()).toContain("demo/scripts/main.js");
    const skillMd = await zip.file("demo/SKILL.md")!.async("string");
    expect(skillMd).toContain("name: demo-skill");
  });

  test("rejects when SKILL.md is missing at the target path", async () => {
    const fetchMock = buildStubFetch({
      sha: "deadbeef",
      tree: {
        "": [{ name: "README.md", type: "file", size: 10 }],
      },
      rawFiles: { "README.md": "# noop\n" },
    });
    await expect(
      fetchSkillFromGitHub({ repo: "acme/x", ref: "main", path: "" }, fetchMock),
    ).rejects.toThrow(/No SKILL\.md/);
  });

  test("rejects when the ref cannot be resolved", async () => {
    const fetchMock = (async (input: RequestInfo | URL): Promise<Response> => {
      const href = typeof input === "string" ? input : input.toString();
      if (href.includes("/commits/")) {
        return new Response("", { status: 404 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    await expect(
      fetchSkillFromGitHub({ repo: "acme/x", ref: "nope" }, fetchMock),
    ).rejects.toThrow(/Ref 'nope' not found/);
  });

  test("honors the maxFiles cap", async () => {
    const files: Array<{ name: string; type: "file"; size: number }> = [
      { name: "SKILL.md", type: "file", size: 10 },
    ];
    for (let i = 0; i < 10; i++) {
      files.push({ name: `f${i}.txt`, type: "file", size: 1 });
    }
    const raw: Record<string, string> = { "SKILL.md": "---\nname: x\n---\n" };
    for (let i = 0; i < 10; i++) raw[`f${i}.txt`] = "x";

    const fetchMock = buildStubFetch({
      sha: "a",
      tree: { "": files },
      rawFiles: raw,
    });

    await expect(
      fetchSkillFromGitHub(
        { repo: "acme/x", ref: "main", maxFiles: 5 },
        fetchMock,
      ),
    ).rejects.toThrow(/exceeds the 5-file cap/);
  });

  test("defaults to HEAD when ref is not provided", async () => {
    const fetchMock = buildStubFetch({
      sha: "headsha",
      tree: {
        "": [{ name: "SKILL.md", type: "file", size: 10 }],
      },
      rawFiles: { "SKILL.md": "---\nname: r\n---\n" },
    });
    const result = await fetchSkillFromGitHub({ repo: "acme/x" }, fetchMock);
    expect(result.source.ref).toBe("HEAD");
    expect(result.resolvedCommitSha).toBe("headsha");
  });

  test("token authenticates api.github.com reads but never raw downloads (#1175)", async () => {
    const authByHost: Record<string, Array<string | undefined>> = {};
    const impl = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const u = new URL(url);
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      (authByHost[u.host] ??= []).push(auth);
      if (u.pathname.includes("/commits/")) {
        return new Response(JSON.stringify({ sha: "s" }), { status: 200 });
      }
      if (u.pathname.includes("/contents")) {
        return new Response(
          JSON.stringify([
            {
              name: "SKILL.md",
              path: "SKILL.md",
              type: "file",
              size: 12,
              sha: "x",
              download_url: "https://raw.example/SKILL.md",
            },
          ]),
          { status: 200 },
        );
      }
      if (url.startsWith("https://raw.example/")) {
        return new Response("---\nname: x\n---\n");
      }
      return new Response("nf", { status: 404 });
    }) as unknown as typeof fetch;

    await fetchSkillFromGitHub(
      { repo: "acme/x", ref: "main", token: "ghp_secret" },
      impl,
    );
    // Every api.github.com call carried the bearer; the raw CDN host got none.
    expect(authByHost["api.github.com"]?.every((a) => a === "Bearer ghp_secret")).toBe(true);
    expect(authByHost["raw.example"]?.every((a) => a === undefined)).toBe(true);
  });
});

describe("authHeaders", () => {
  test("no token → no Authorization", () => {
    const h = authHeaders();
    expect(h.Authorization).toBeUndefined();
    expect(h.Accept).toBe("application/vnd.github+json");
    expect(h["User-Agent"]).toBeTruthy();
  });
  test("empty token → no Authorization", () => {
    expect(authHeaders("").Authorization).toBeUndefined();
  });
  test("non-empty token → Bearer Authorization", () => {
    expect(authHeaders("ghp_tok").Authorization).toBe("Bearer ghp_tok");
  });
});

describe("resolveRefHeadSha", () => {
  test("pinned 40-hex SHA short-circuits with ZERO http calls", async () => {
    const { impl, calls } = recordingFetch(
      () => new Response("must not be called", { status: 500 }),
    );
    const sha = "a1b2c3d4".repeat(5); // 40 hex chars
    const res = await resolveRefHeadSha("acme/x", sha, {}, impl);
    expect(res).toEqual({ sha, notModified: false });
    expect(calls.length).toBe(0);
  });

  test("branch 200 → object.sha + etag; sends Authorization, no If-None-Match", async () => {
    const { impl, calls } = recordingFetch(
      () =>
        new Response(JSON.stringify({ object: { sha: "newsha" } }), {
          status: 200,
          headers: { etag: 'W/"abc"' },
        }),
    );
    const res = await resolveRefHeadSha("acme/x", "main", { token: "ghp_t" }, impl);
    expect(res).toEqual({ sha: "newsha", etag: 'W/"abc"', notModified: false });
    expect(calls[0]!.url).toContain("/git/ref/heads/main");
    expect(calls[0]!.headers.Authorization).toBe("Bearer ghp_t");
    expect(calls[0]!.headers["If-None-Match"]).toBeUndefined();
  });

  test("304 with stored etag → notModified, replays If-None-Match", async () => {
    const { impl, calls } = recordingFetch(() => new Response(null, { status: 304 }));
    const res = await resolveRefHeadSha(
      "acme/x",
      "main",
      { token: "t", etag: 'W/"prev"' },
      impl,
    );
    expect(res).toEqual({ notModified: true });
    expect(calls[0]!.headers["If-None-Match"]).toBe('W/"prev"');
  });

  test("no token → request carries no Authorization", async () => {
    const { impl, calls } = recordingFetch(
      () => new Response(JSON.stringify({ object: { sha: "s" } }), { status: 200 }),
    );
    await resolveRefHeadSha("acme/x", "main", {}, impl);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  test("404 on heads AND tags → GitHubSourceNotFoundError", async () => {
    const { impl, calls } = recordingFetch(() => new Response("nf", { status: 404 }));
    await expect(resolveRefHeadSha("acme/x", "gone", {}, impl)).rejects.toBeInstanceOf(
      GitHubSourceNotFoundError,
    );
    expect(calls.length).toBe(2);
    expect(calls[0]!.url).toContain("/git/ref/heads/gone");
    expect(calls[1]!.url).toContain("/git/ref/tags/gone");
  });

  test("404 heads then 200 tags → resolves via tag fallback", async () => {
    const { impl } = recordingFetch((url) =>
      url.includes("/git/ref/heads/")
        ? new Response("nf", { status: 404 })
        : new Response(JSON.stringify({ object: { sha: "tagsha" } }), { status: 200 }),
    );
    const res = await resolveRefHeadSha("acme/x", "v1.0", {}, impl);
    expect(res.sha).toBe("tagsha");
  });

  test("slashed branch name keeps its path segments (not %2F)", async () => {
    const { impl, calls } = recordingFetch(
      () => new Response(JSON.stringify({ object: { sha: "s" } }), { status: 200 }),
    );
    await resolveRefHeadSha("acme/x", "feature/foo", {}, impl);
    expect(calls[0]!.url).toContain("/git/ref/heads/feature/foo");
  });
});
