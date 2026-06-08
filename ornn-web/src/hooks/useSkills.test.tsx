/**
 * useSkills — version-write hooks: GUID-on-the-wire / name-in-the-cache.
 *
 * #750 regression guard. Skill Detail can be opened by NAME (URL
 * `idOrName`), but the version-delete / version-deprecation backend
 * routes are GUID-only (`findByGuid`, CONVENTIONS §2.2). Before the fix
 * the hooks sent the cache-key id (the name) on the wire → `findByGuid`
 * 404 → version never deleted. The fix splits the two ids:
 *
 *   - WIRE id   = `guid`     → goes into the request URL.
 *   - CACHE id  = `idOrName` → keys every `invalidateQueries`, so #699's
 *                              All-versions modal still refreshes.
 *
 * Both matrices run: name-opened (`guid !== name`) and guid-opened
 * (`guid === name`). The fetch layer is spied at `globalThis.fetch`
 * because both `deleteSkillVersion` (via `apiDelete`) and
 * `setSkillVersionDeprecation` (raw `fetch`) bottom out there.
 *
 * @module hooks/useSkills.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Stub the auth store so importing the api layer doesn't drag in the
// persist-middleware localStorage init chain on module load (same trap
// MirrorPage.test.tsx sidesteps). The hooks under test only need
// `getState().accessToken` (null → no proactive token refresh, so the
// fetch spy sees exactly one call).
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

import { useDeleteSkillVersion, useSetVersionDeprecation } from "./useSkills";

const GUID = "11111111-2222-3333-4444-555555555555";
const NAME = "my-skill";
const VERSION = "1.0.0";

/** Pull the request URL out of the first `fetch` call (URL or Request). */
function fetchedUrl(spy: ReturnType<typeof vi.spyOn>): string {
  const [input] = spy.mock.calls[0] ?? [];
  return typeof input === "string" ? input : (input as Request).url;
}

/** Fresh client per test so invalidation spies don't leak across cases. */
function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
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

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDeleteSkillVersion", () => {
  // Backend DELETE returns 204; apiClient short-circuits on 204.
  function stubDelete() {
    return vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
  }

  it.each([
    ["name-opened (guid !== name)", GUID, NAME],
    ["guid-opened (guid === name)", GUID, GUID],
  ])("sends the GUID on the wire, not the cache id — %s", async (_label, guid, cacheId) => {
    const fetchSpy = stubDelete();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteSkillVersion(guid, cacheId), { wrapper });

    await result.current.mutateAsync(VERSION);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = fetchedUrl(fetchSpy);
    // 404-regression guard: the URL carries the GUID.
    expect(url).toContain(encodeURIComponent(guid));
    expect(url).toContain(`/versions/${encodeURIComponent(VERSION)}`);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("does NOT put the name in the URL when opened by name", async () => {
    const fetchSpy = stubDelete();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteSkillVersion(GUID, NAME), { wrapper });

    await result.current.mutateAsync(VERSION);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The skill-segment of the path is the GUID, never the name (#750).
    expect(fetchedUrl(fetchSpy)).toContain(`/skills/${encodeURIComponent(GUID)}/`);
    expect(fetchedUrl(fetchSpy)).not.toContain(`/skills/${encodeURIComponent(NAME)}/`);
  });

  it("invalidates caches keyed on the name (#699 refresh guard)", async () => {
    stubDelete();
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useDeleteSkillVersion(GUID, NAME), { wrapper });

    await result.current.mutateAsync(VERSION);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // #699 — All-versions modal subscribes to [skill-versions, name].
    expect(invalidatedKey(invalidateSpy, ["skill-versions", NAME])).toBe(true);
    // Detail cache + collections.
    expect(invalidatedKey(invalidateSpy, ["skills", NAME])).toBe(true);
    expect(invalidatedKey(invalidateSpy, ["skills"])).toBe(true);
    expect(invalidatedKey(invalidateSpy, ["my-skills"])).toBe(true);
    // Audit history (per-version) — predicate-keyed on the name.
    const auditPredicateFired = invalidateSpy.mock.calls.some(
      ([arg]) =>
        arg != null &&
        typeof arg === "object" &&
        "predicate" in arg &&
        (arg as { predicate: (q: { queryKey: unknown[] }) => boolean }).predicate({
          queryKey: ["audit", NAME],
        }),
    );
    expect(auditPredicateFired).toBe(true);
  });

  it("never keys invalidation on the GUID when opened by name", async () => {
    stubDelete();
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useDeleteSkillVersion(GUID, NAME), { wrapper });

    await result.current.mutateAsync(VERSION);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidatedKey(invalidateSpy, ["skill-versions", GUID])).toBe(false);
    expect(invalidatedKey(invalidateSpy, ["skills", GUID])).toBe(false);
  });
});

describe("useSetVersionDeprecation", () => {
  // PATCH returns the updated row in a `{ data }` envelope.
  function stubPatch() {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            skillGuid: GUID,
            skillName: NAME,
            version: VERSION,
            isDeprecated: true,
            deprecationNote: null,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }

  it.each([
    ["name-opened (guid !== name)", GUID, NAME],
    ["guid-opened (guid === name)", GUID, GUID],
  ])("sends the GUID on the wire, not the cache id — %s", async (_label, guid, cacheId) => {
    const fetchSpy = stubPatch();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSetVersionDeprecation(guid, cacheId), { wrapper });

    await result.current.mutateAsync({ version: VERSION, isDeprecated: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = fetchedUrl(fetchSpy);
    expect(url).toContain(encodeURIComponent(guid));
    expect(url).toContain(`/versions/${encodeURIComponent(VERSION)}`);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
  });

  it("does NOT put the name in the URL when opened by name", async () => {
    const fetchSpy = stubPatch();
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useSetVersionDeprecation(GUID, NAME), { wrapper });

    await result.current.mutateAsync({ version: VERSION, isDeprecated: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchedUrl(fetchSpy)).toContain(`/skills/${encodeURIComponent(GUID)}/`);
    expect(fetchedUrl(fetchSpy)).not.toContain(`/skills/${encodeURIComponent(NAME)}/`);
  });

  it("invalidates caches keyed on the name", async () => {
    stubPatch();
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useSetVersionDeprecation(GUID, NAME), { wrapper });

    await result.current.mutateAsync({ version: VERSION, isDeprecated: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidatedKey(invalidateSpy, ["skills", NAME])).toBe(true);
    expect(invalidatedKey(invalidateSpy, ["skill-versions", NAME])).toBe(true);
    // Cache keys must never be the GUID when opened by name.
    expect(invalidatedKey(invalidateSpy, ["skills", GUID])).toBe(false);
    expect(invalidatedKey(invalidateSpy, ["skill-versions", GUID])).toBe(false);
  });
});
