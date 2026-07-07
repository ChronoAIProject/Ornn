import { describe, expect, test } from "bun:test";
import { SkillService, type SkillServiceDeps } from "./service";
import type { SkillDocument } from "../../../shared/types/index";

/**
 * End-to-end coverage of `SkillService.checkSourceDrift` — token precedence
 * (settings > env > anonymous) and the delegation into the real
 * `resolveRefHeadSha` probe. We patch `globalThis.fetch` so the whole chain
 * runs without network and without adding test-only surface to prod deps.
 */

function githubSkillDoc(): SkillDocument {
  return {
    source: {
      type: "github",
      repo: "acme/x",
      ref: "main",
      path: "",
      lastSyncedCommit: "old",
    },
  } as unknown as SkillDocument;
}

function makeService(opts: {
  settingsToken?: string;
  envToken?: string;
  skill?: SkillDocument | null;
}): { svc: SkillService; persisted: Array<Record<string, unknown>> } {
  const persisted: Array<Record<string, unknown>> = [];
  const deps = {
    skillRepo: {
      findByGuid: async () =>
        opts.skill === undefined ? githubSkillDoc() : opts.skill,
      updateSourceDriftState: async (
        _g: string,
        patch: Record<string, unknown>,
      ) => {
        persisted.push(patch);
      },
    },
    ...(opts.settingsToken !== undefined
      ? {
          sourceSyncSettings: {
            getSourceSync: async () =>
              ({ githubToken: opts.settingsToken }) as never,
          },
        }
      : {}),
    ...(opts.envToken !== undefined
      ? { sourceSyncGithubTokenFallback: opts.envToken }
      : {}),
  } as unknown as SkillServiceDeps;
  return { svc: new SkillService(deps), persisted };
}

function recordingFetch(responder: (url: string) => Response): {
  impl: typeof fetch;
  calls: Array<{ url: string; auth: string | undefined }>;
} {
  const calls: Array<{ url: string; auth: string | undefined }> = [];
  const impl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({
      url,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    });
    return responder(url);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

describe("SkillService.checkSourceDrift", () => {
  test("settings token wins over env fallback and authenticates the probe", async () => {
    const { impl, calls } = recordingFetch(
      () =>
        new Response(JSON.stringify({ object: { sha: "new" } }), {
          status: 200,
          headers: { etag: 'W/"e"' },
        }),
    );
    await withFetch(impl, async () => {
      const { svc, persisted } = makeService({
        settingsToken: "SETTINGS_TOK",
        envToken: "ENV_TOK",
      });
      const res = await svc.checkSourceDrift("g1");
      expect(res).toEqual({
        applicable: true,
        driftState: "drifted",
        upstreamHeadSha: "new",
      });
      expect(calls[0]!.auth).toBe("Bearer SETTINGS_TOK");
      expect(persisted[0]).toMatchObject({ driftState: "drifted", upstreamHeadSha: "new" });
    });
  });

  test("empty settings token falls back to the env token", async () => {
    const { impl, calls } = recordingFetch(
      () => new Response(JSON.stringify({ object: { sha: "old" } }), { status: 200 }),
    );
    await withFetch(impl, async () => {
      const { svc } = makeService({ settingsToken: "", envToken: "ENV_TOK" });
      await svc.checkSourceDrift("g1");
      expect(calls[0]!.auth).toBe("Bearer ENV_TOK");
    });
  });

  test("no token anywhere → anonymous probe (no Authorization header)", async () => {
    const { impl, calls } = recordingFetch(
      () => new Response(JSON.stringify({ object: { sha: "old" } }), { status: 200 }),
    );
    await withFetch(impl, async () => {
      const { svc } = makeService({ skill: githubSkillDoc() });
      await svc.checkSourceDrift("g1");
      expect(calls[0]!.auth).toBeUndefined();
    });
  });

  test("non-github skill → applicable:false with no network call", async () => {
    const { impl, calls } = recordingFetch(() => new Response("x", { status: 500 }));
    await withFetch(impl, async () => {
      const { svc } = makeService({
        skill: { source: undefined } as unknown as SkillDocument,
      });
      const res = await svc.checkSourceDrift("g1");
      expect(res).toEqual({ applicable: false });
      expect(calls.length).toBe(0);
    });
  });
});
