/**
 * Tests for `usePreferredModel`.
 *
 * Three load-bearing behaviors:
 *  1. Stored model that's still enabled wins.
 *  2. Stored model that's been disabled silently falls back to the
 *     admin default — without clearing storage.
 *  3. With no stored value, the admin default is used.
 *
 * @module hooks/useModels.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PickerResult } from "@/services/modelsApi";

// Mock the auth store so `usePickerModels` is enabled.
vi.mock("@/stores/authStore", () => ({
  useIsAuthenticated: () => true,
}));

const fetchPickerModels = vi.fn();

vi.mock("@/services/modelsApi", () => ({
  fetchPickerModels: (...args: unknown[]) => fetchPickerModels(...args),
  fetchAdminModels: vi.fn(),
  refreshModelCatalog: vi.fn(),
  patchModelFlags: vi.fn(),
}));

import { usePreferredModel } from "./useModels";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const KEY = "ornn.preferredModel.playground";

/**
 * bun's test runner injects a stripped-down localStorage object that
 * jsdom doesn't override. Replace it with an in-memory shim every test
 * so getItem / setItem / removeItem are guaranteed to exist.
 */
function installStorageShim(): void {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(k) {
      return store.has(k) ? (store.get(k) as string) : null;
    },
    key(i) {
      return Array.from(store.keys())[i] ?? null;
    },
    removeItem(k) {
      store.delete(k);
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: shim,
  });
}

describe("usePreferredModel", () => {
  beforeEach(() => {
    fetchPickerModels.mockReset();
    installStorageShim();
  });

  afterEach(() => {
    installStorageShim();
  });

  it("uses the admin default when no value is stored", async () => {
    const result: PickerResult = {
      items: [
        { modelId: "gpt-5", displayName: "GPT 5", isDefault: true },
        { modelId: "gpt-5-mini", displayName: "GPT 5 mini", isDefault: false },
      ],
      defaultModelId: "gpt-5",
    };
    fetchPickerModels.mockResolvedValue(result);

    const { result: hookResult } = renderHook(
      () => usePreferredModel("playground"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() =>
      expect(hookResult.current.effectiveModelId).toBe("gpt-5"),
    );
    expect(hookResult.current.storedModelId).toBeNull();
  });

  it("uses the stored value when it's still enabled", async () => {
    window.localStorage.setItem(KEY, "gpt-5-mini");
    const result: PickerResult = {
      items: [
        { modelId: "gpt-5", displayName: "GPT 5", isDefault: true },
        { modelId: "gpt-5-mini", displayName: "GPT 5 mini", isDefault: false },
      ],
      defaultModelId: "gpt-5",
    };
    fetchPickerModels.mockResolvedValue(result);

    const { result: hookResult } = renderHook(
      () => usePreferredModel("playground"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() =>
      expect(hookResult.current.effectiveModelId).toBe("gpt-5-mini"),
    );
    expect(hookResult.current.storedModelId).toBe("gpt-5-mini");
  });

  it("falls back to default when the stored model is no longer enabled, without clearing storage", async () => {
    window.localStorage.setItem(KEY, "gpt-4-old");
    const result: PickerResult = {
      items: [
        { modelId: "gpt-5", displayName: "GPT 5", isDefault: true },
      ],
      defaultModelId: "gpt-5",
    };
    fetchPickerModels.mockResolvedValue(result);

    const { result: hookResult } = renderHook(
      () => usePreferredModel("playground"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() =>
      expect(hookResult.current.effectiveModelId).toBe("gpt-5"),
    );
    // Storage is preserved so a later re-enable restores the user pick.
    expect(window.localStorage.getItem(KEY)).toBe("gpt-4-old");
    expect(hookResult.current.storedModelId).toBe("gpt-4-old");
  });

  it("setPreferred persists to localStorage and updates effective", async () => {
    const result: PickerResult = {
      items: [
        { modelId: "gpt-5", displayName: "GPT 5", isDefault: true },
        { modelId: "gpt-5-mini", displayName: "GPT 5 mini", isDefault: false },
      ],
      defaultModelId: "gpt-5",
    };
    fetchPickerModels.mockResolvedValue(result);

    const { result: hookResult } = renderHook(
      () => usePreferredModel("playground"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() =>
      expect(hookResult.current.effectiveModelId).toBe("gpt-5"),
    );

    act(() => hookResult.current.setPreferred("gpt-5-mini"));

    expect(window.localStorage.getItem(KEY)).toBe("gpt-5-mini");
    await waitFor(() =>
      expect(hookResult.current.effectiveModelId).toBe("gpt-5-mini"),
    );
  });

  it("flags isEmpty when admin has nothing enabled for the surface", async () => {
    const result: PickerResult = { items: [], defaultModelId: null };
    fetchPickerModels.mockResolvedValue(result);

    const { result: hookResult } = renderHook(
      () => usePreferredModel("playground"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(hookResult.current.isLoading).toBe(false));
    expect(hookResult.current.isEmpty).toBe(true);
    expect(hookResult.current.effectiveModelId).toBeNull();
  });
});
