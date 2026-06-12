/**
 * useSkillsets — mutation invalidation + the #940 delete-cache guard.
 *
 * The load-bearing case mirrors `useSkills.test.tsx`: when a skillset is
 * deleted, the still-mounted detail page must NOT refetch it (→ 404). The
 * delete hook copies the #940 `removeQueries` predicate, removing the
 * detail + versions + closure cache entries (scoped to guid / idOrName)
 * BEFORE invalidating the list keys. This test seeds those caches, runs the
 * delete, and asserts the entries are gone — not merely invalidated.
 *
 * The auth store is stubbed so the api layer's module-load chain stays out of
 * the test and `accessToken` is null (one fetch call per mutation).
 *
 * @module hooks/useSkillsets.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

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
  useDeleteSkillset,
  usePublishSkillset,
  useUpdateSkillsetPermissions,
  useCreateSkillset,
} from "./useSkillsets";

const GUID = "11111111-2222-3333-4444-555555555555";
const NAME = "research-bundle";

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const removeSpy = vi.spyOn(queryClient, "removeQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy, removeSpy, queryClient };
}

/** Did `removeQueries` fire with a predicate that matches this queryKey? */
function removedKey(
  spy: ReturnType<typeof vi.spyOn>,
  key: readonly unknown[],
): boolean {
  return spy.mock.calls.some(
    ([arg]) =>
      arg != null &&
      typeof arg === "object" &&
      "predicate" in arg &&
      (arg as { predicate: (q: { queryKey: readonly unknown[] }) => boolean }).predicate({
        queryKey: key,
      }),
  );
}

/** Did `invalidateQueries` fire with exactly this queryKey? */
function invalidatedKey(
  spy: ReturnType<typeof vi.spyOn>,
  key: readonly unknown[],
): boolean {
  return spy.mock.calls.some(
    ([arg]) =>
      arg != null &&
      typeof arg === "object" &&
      "queryKey" in arg &&
      JSON.stringify((arg as { queryKey?: unknown }).queryKey) === JSON.stringify(key),
  );
}

function url(spy: ReturnType<typeof vi.spyOn>): string {
  const [input] = spy.mock.calls[0] ?? [];
  return typeof input === "string" ? input : (input as Request).url;
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDeleteSkillset (#940 delete-cache guard)", () => {
  function stubDelete() {
    return vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
  }

  it("removes the deleted skillset's detail + versions + closure cache (name-keyed) so nothing refetches → 404", async () => {
    stubDelete();
    const { wrapper, removeSpy, invalidateSpy, queryClient } = makeWrapper();

    // Seed the still-mounted caches keyed on the NAME (the detail URL id).
    queryClient.setQueryData(["skillsets", NAME, "latest"], { guid: GUID, name: NAME });
    queryClient.setQueryData(["skillset-versions", NAME], [{ version: "1.0" }]);
    queryClient.setQueryData(["skillset-closure", NAME, "latest"], { instructions: "x", items: [] });

    const { result } = renderHook(() => useDeleteSkillset(GUID, NAME), { wrapper });
    await result.current.mutateAsync();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // (a) removeQueries fired for the detail + versions + closure keys.
    expect(removedKey(removeSpy, ["skillsets", NAME, "latest"])).toBe(true);
    expect(removedKey(removeSpy, ["skillset-versions", NAME])).toBe(true);
    expect(removedKey(removeSpy, ["skillset-closure", NAME, "latest"])).toBe(true);

    // (b) the entries are actually gone — nothing left to refetch.
    expect(queryClient.getQueryData(["skillsets", NAME, "latest"])).toBeUndefined();
    expect(queryClient.getQueryData(["skillset-versions", NAME])).toBeUndefined();
    expect(queryClient.getQueryData(["skillset-closure", NAME, "latest"])).toBeUndefined();

    // (c) lists still invalidate to drop the deleted card.
    expect(invalidatedKey(invalidateSpy, ["skillsets"])).toBe(true);
    expect(invalidatedKey(invalidateSpy, ["my-skillsets"])).toBe(true);
  });

  it("removes a GUID-keyed detail entry too (predicate covers both keyings)", async () => {
    stubDelete();
    const { wrapper, removeSpy, queryClient } = makeWrapper();

    // Browse card passes the card's GUID as the cache-key id.
    queryClient.setQueryData(["skillsets", GUID, "latest"], { guid: GUID, name: NAME });

    const { result } = renderHook(() => useDeleteSkillset(GUID, GUID), { wrapper });
    await result.current.mutateAsync();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(removedKey(removeSpy, ["skillsets", GUID, "latest"])).toBe(true);
    expect(queryClient.getQueryData(["skillsets", GUID, "latest"])).toBeUndefined();
  });

  it("sends the GUID on the wire, not the name, when opened by name", async () => {
    const fetchSpy = stubDelete();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteSkillset(GUID, NAME), { wrapper });

    await result.current.mutateAsync();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(url(fetchSpy)).toContain(`/skillsets/${encodeURIComponent(GUID)}`);
    expect(url(fetchSpy)).not.toContain(`/skillsets/${encodeURIComponent(NAME)}`);
  });
});

describe("usePublishSkillset", () => {
  it("PUTs the GUID, primes the detail cache, and invalidates name-keyed reads", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ guid: GUID, name: NAME, version: "1.1" }));
    const { wrapper, invalidateSpy, queryClient } = makeWrapper();
    const setSpy = vi.spyOn(queryClient, "setQueryData");
    const { result } = renderHook(() => usePublishSkillset(GUID, NAME), { wrapper });

    await result.current.mutateAsync({
      instructions: "Run A then B then C.",
      members: ["a@1.0", "b@1.0", "c@1.0"],
      version: "1.1",
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // GUID on the wire (publish is GUID-only).
    expect(url(fetchSpy)).toContain(`/skillsets/${encodeURIComponent(GUID)}`);
    // Detail (latest) cache primed with the published payload. Asserted via
    // the setQueryData call (a subsequent broad invalidate would GC the
    // inactive entry under gcTime:0, so reading the cache back is flaky).
    const primed = setSpy.mock.calls.some(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(["skillsets", NAME, "latest"]) &&
        (value as { version?: string })?.version === "1.1",
    );
    expect(primed).toBe(true);
    // Name-keyed reads invalidated.
    expect(invalidatedKey(invalidateSpy, ["skillset-versions", NAME])).toBe(true);
    expect(invalidatedKey(invalidateSpy, ["skillsets", NAME])).toBe(true);
  });
});

describe("useUpdateSkillsetPermissions", () => {
  it("PUTs /permissions on the GUID and invalidates the name-keyed detail", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ skillset: { guid: GUID, name: NAME, isPrivate: true } }));
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useUpdateSkillsetPermissions(GUID, NAME), { wrapper });

    await result.current.mutateAsync({
      isPrivate: true,
      sharedWithUsers: [],
      sharedWithOrgs: [],
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(url(fetchSpy)).toContain(`/skillsets/${encodeURIComponent(GUID)}/permissions`);
    expect(invalidatedKey(invalidateSpy, ["skillsets", NAME])).toBe(true);
  });
});

describe("useCreateSkillset", () => {
  it("POSTs and invalidates the public + mine list tabs", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ guid: GUID, name: NAME }));
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useCreateSkillset(), { wrapper });

    await result.current.mutateAsync({
      name: NAME,
      description: "desc",
      instructions: "do the thing",
      kind: "generic",
      tags: [],
      members: ["a@1.0", "b@1.0"],
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(url(fetchSpy)).toMatch(/\/api\/v1\/skillsets$/);
    expect(invalidatedKey(invalidateSpy, ["skillsets"])).toBe(true);
    expect(invalidatedKey(invalidateSpy, ["my-skillsets"])).toBe(true);
  });
});
