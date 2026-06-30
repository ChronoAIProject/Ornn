/**
 * skillsetApi — verb / path / body per function.
 *
 * The 8 functions bottom out in the local `apiClient` wrappers (apiGet /
 * apiPost / apiPut / apiDelete), which all bottom out in `globalThis.fetch`.
 * Spying there lets us assert the wire shape without a server: the HTTP verb,
 * the URL (GUID-only write routes, `?version` on reads), and the JSON body.
 *
 * The auth store is stubbed so importing the api layer doesn't drag in the
 * persist-middleware localStorage chain on module load, and so `accessToken`
 * is null (no proactive refresh → exactly one fetch call per function).
 *
 * @module services/skillsetApi.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/stores/authStore", () => ({
  useAuthStore: {
    getState: () => ({
      accessToken: null,
      isAuthenticated: false,
      ensureFreshToken: async () => {},
      refreshToken: async () => {},
    }),
  },
}));

import {
  searchSkillsets,
  fetchSkillset,
  fetchSkillsetVersions,
  fetchSkillsetClosure,
  createSkillset,
  publishSkillset,
  deleteSkillset,
} from "./skillsetApi";
import type {
  CreateSkillsetInput,
  PublishSkillsetInput,
} from "@/types/skillset";

const GUID = "11111111-2222-3333-4444-555555555555";
const NAME = "research-bundle";

/** A 200 JSON `{ data }` envelope. */
function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function url(spy: ReturnType<typeof vi.spyOn>): string {
  const [input] = spy.mock.calls[0] ?? [];
  return typeof input === "string" ? input : (input as Request).url;
}

function init(spy: ReturnType<typeof vi.spyOn>): RequestInit {
  return (spy.mock.calls[0]?.[1] ?? {}) as RequestInit;
}

function body(spy: ReturnType<typeof vi.spyOn>): unknown {
  const raw = init(spy).body;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchSkillsets", () => {
  it("GETs /skillset-search with kind + scope + joined tags", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
    );
    await searchSkillsets({
      kind: "consensus-supported",
      scope: "mine",
      page: 2,
      pageSize: 20,
      tags: ["research", "rag"],
    });
    const u = url(fetchSpy);
    expect(init(fetchSpy).method).toBe("GET");
    expect(u).toContain("/api/v1/skillset-search");
    expect(u).toContain("kind=consensus-supported");
    expect(u).toContain("scope=mine");
    expect(u).toContain("page=2");
    expect(u).toContain("tags=research%2Crag");
  });

  it("omits empty tag lists from the query", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
    );
    await searchSkillsets({ scope: "public", tags: [] });
    expect(url(fetchSpy)).not.toContain("tags=");
  });
});

describe("fetchSkillset", () => {
  it("GETs /skillsets/:idOrName with no version suffix by default", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ guid: GUID, name: NAME }));
    await fetchSkillset(NAME);
    expect(init(fetchSpy).method).toBe("GET");
    expect(url(fetchSpy)).toContain(`/api/v1/skillsets/${NAME}`);
    expect(url(fetchSpy)).not.toContain("version=");
  });

  it("appends ?version when a specific version is requested", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ guid: GUID, name: NAME }));
    await fetchSkillset(NAME, "1.2");
    expect(url(fetchSpy)).toContain("version=1.2");
  });
});

describe("fetchSkillsetVersions", () => {
  it("GETs /versions and unwraps the items array", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ items: [{ version: "1.0" }] }));
    const out = await fetchSkillsetVersions(NAME);
    expect(url(fetchSpy)).toContain(`/api/v1/skillsets/${NAME}/versions`);
    expect(out).toEqual([{ version: "1.0" }]);
  });

  it("returns [] when the envelope has no items", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    expect(await fetchSkillsetVersions(NAME)).toEqual([]);
  });
});

describe("fetchSkillsetClosure", () => {
  it("GETs /closure and returns { instructions, items }", async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ instructions: "use A then B", items: [] }),
    );
    const out = await fetchSkillsetClosure(NAME, "1.0");
    expect(url(fetchSpy)).toContain(`/api/v1/skillsets/${NAME}/closure`);
    expect(url(fetchSpy)).toContain("version=1.0");
    expect(out.instructions).toBe("use A then B");
  });
});

describe("createSkillset", () => {
  it("POSTs /skillsets with the full create body", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ guid: GUID, name: NAME }));
    const input: CreateSkillsetInput = {
      name: NAME,
      description: "A research bundle",
      instructions: "Run A, then B.",
      kind: "generic",
      tags: ["research"],
      members: ["a@1.0", "b@1.0"],
    };
    await createSkillset(input);
    expect(init(fetchSpy).method).toBe("POST");
    expect(url(fetchSpy)).toMatch(/\/api\/v1\/skillsets$/);
    expect(body(fetchSpy)).toMatchObject({
      name: NAME,
      members: ["a@1.0", "b@1.0"],
      instructions: "Run A, then B.",
    });
  });
});

describe("publishSkillset", () => {
  it("PUTs /skillsets/:guid (GUID-only) with the publish body", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ guid: GUID, name: NAME }));
    const input: PublishSkillsetInput = {
      description: "Updated",
      instructions: "Run A, then B, then C.",
      kind: "consensus-supported",
      tags: ["research"],
      members: ["a@1.0", "b@1.0", "c@1.0"],
    };
    await publishSkillset(GUID, input);
    expect(init(fetchSpy).method).toBe("PUT");
    expect(url(fetchSpy)).toContain(`/api/v1/skillsets/${GUID}`);
    expect(url(fetchSpy)).not.toContain("/permissions");
    // The publish body carries no version — the revision is system-assigned (#1162).
    expect(body(fetchSpy)).toMatchObject({ members: ["a@1.0", "b@1.0", "c@1.0"] });
    expect(body(fetchSpy)).not.toHaveProperty("version");
  });
});

describe("deleteSkillset", () => {
  it("DELETEs /skillsets/:guid (GUID-only)", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    await deleteSkillset(GUID);
    expect(init(fetchSpy).method).toBe("DELETE");
    expect(url(fetchSpy)).toContain(`/api/v1/skillsets/${GUID}`);
  });
});

// NOTE (#1136): no updateSkillsetPermissions test — the function was removed
// (skillset visibility is derived from members, not owner-set).
