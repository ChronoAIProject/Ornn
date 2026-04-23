import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import {
  fetchSkillFromGitHub,
  normalizePath,
  normalizeRepoIdentifier,
} from "./githubPull";

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
      return new Response(content);
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
});
