import { describe, expect, test } from "bun:test";
import { fetchGithubSourceBundle, parseRepoUrl } from "./githubFetcher";

describe("parseRepoUrl", () => {
  test("plain repo URL", () => {
    expect(parseRepoUrl("https://github.com/honojs/hono")).toEqual({
      owner: "honojs",
      repo: "hono",
      ref: "HEAD",
      subpath: undefined,
    });
  });

  test("strips .git suffix", () => {
    expect(parseRepoUrl("https://github.com/honojs/hono.git")).toMatchObject({
      owner: "honojs",
      repo: "hono",
    });
  });

  test("tree URL with ref", () => {
    expect(parseRepoUrl("https://github.com/honojs/hono/tree/main")).toEqual({
      owner: "honojs",
      repo: "hono",
      ref: "main",
      subpath: undefined,
    });
  });

  test("tree URL with ref and subpath", () => {
    expect(parseRepoUrl("https://github.com/honojs/hono/tree/main/src/routing")).toEqual({
      owner: "honojs",
      repo: "hono",
      ref: "main",
      subpath: "src/routing",
    });
  });

  test("rejects non-github URL", () => {
    expect(parseRepoUrl("https://gitlab.com/x/y")).toBeNull();
  });

  test("rejects malformed URL", () => {
    expect(parseRepoUrl("not a url")).toBeNull();
  });

  test("rejects repo URL missing repo segment", () => {
    expect(parseRepoUrl("https://github.com/honojs")).toBeNull();
  });
});

describe("fetchGithubSourceBundle", () => {
  test("fetches top-level files + concatenates with FILE markers", async () => {
    const fetchMock = (async (url: string | URL): Promise<Response> => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.startsWith("https://api.github.com/repos/acme/api/contents/src/routes")) {
        return new Response(
          JSON.stringify([
            {
              name: "users.ts",
              path: "src/routes/users.ts",
              type: "file",
              size: 120,
              download_url: "https://raw.example/users.ts",
            },
            {
              name: "README.md",
              path: "src/routes/README.md",
              type: "file",
              size: 99,
              download_url: "https://raw.example/README.md",
            },
            {
              name: "items.ts",
              path: "src/routes/items.ts",
              type: "file",
              size: 200,
              download_url: "https://raw.example/items.ts",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (href === "https://raw.example/users.ts") {
        return new Response(
          "import { Hono } from 'hono';\napp.get('/users', handler);\n",
          { status: 200 },
        );
      }
      if (href === "https://raw.example/items.ts") {
        return new Response("app.get('/items', itemsHandler);\n", { status: 200 });
      }
      return new Response("404", { status: 404 });
    }) as unknown as typeof fetch;

    const bundle = await fetchGithubSourceBundle(
      "https://github.com/acme/api/tree/main/src/routes",
      { maxFiles: 5 },
      fetchMock,
    );
    expect(bundle.files.length).toBe(2);
    expect(bundle.code).toContain("// FILE: src/routes/users.ts");
    expect(bundle.code).toContain("// FILE: src/routes/items.ts");
    expect(bundle.code).not.toContain("README.md");
    expect(bundle.frameworkHint).toBe("hono");
    expect(bundle.source).toEqual({ owner: "acme", repo: "api", ref: "main" });
  });

  test("falls back to repo root when no common route folders match", async () => {
    let firstContentsCall = true;
    const fetchMock = (async (url: string | URL): Promise<Response> => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.startsWith("https://api.github.com/repos/flat/lib/contents")) {
        // All sub-path lookups 404
        if (href.includes("/contents/src") || href.includes("/contents/routes") || href.includes("/contents/controllers") || href.includes("/contents/handlers") || href.includes("/contents/app")) {
          return new Response("{}", { status: 404 });
        }
        // Root listing
        if (href.endsWith("/contents")) {
          firstContentsCall = false;
          return new Response(
            JSON.stringify([
              {
                name: "main.py",
                path: "main.py",
                type: "file",
                size: 500,
                download_url: "https://raw.example/main.py",
              },
            ]),
            { status: 200 },
          );
        }
      }
      if (href === "https://raw.example/main.py") {
        return new Response("from fastapi import FastAPI\napp = FastAPI()\n", { status: 200 });
      }
      return new Response("404", { status: 404 });
    }) as unknown as typeof fetch;

    const bundle = await fetchGithubSourceBundle(
      "https://github.com/flat/lib",
      {},
      fetchMock,
    );
    expect(firstContentsCall).toBe(false);
    expect(bundle.files[0]?.path).toBe("main.py");
    expect(bundle.frameworkHint).toBe("fastapi");
  });

  test("rejects non-GitHub URL", async () => {
    await expect(
      fetchGithubSourceBundle("https://gitlab.com/x/y", {}, globalThis.fetch),
    ).rejects.toThrow(/Not a recognized GitHub URL/);
  });

  test("truncates files larger than maxBytesPerFile", async () => {
    const bigFile = "x".repeat(5_000);
    const fetchMock = (async (url: string | URL): Promise<Response> => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/contents/")) {
        return new Response(
          JSON.stringify([
            {
              name: "big.ts",
              path: "src/routes/big.ts",
              type: "file",
              size: bigFile.length,
              download_url: "https://raw.example/big.ts",
            },
          ]),
          { status: 200 },
        );
      }
      if (href === "https://raw.example/big.ts") {
        return new Response(bigFile, { status: 200 });
      }
      return new Response("404", { status: 404 });
    }) as unknown as typeof fetch;

    const bundle = await fetchGithubSourceBundle(
      "https://github.com/acme/api/tree/main/src/routes",
      { maxBytesPerFile: 1_000 },
      fetchMock,
    );
    expect(bundle.code).toContain("... truncated");
    expect(bundle.code.length).toBeLessThan(bigFile.length);
  });
});
