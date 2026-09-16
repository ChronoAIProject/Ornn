/**
 * UT-WEB-GENERATION-MODE-PREF-001 (#1242)
 *
 * Pins the localStorage-backed mode preference: default `advanced`,
 * round-trip through storage, rejection of unknown stored values,
 * cross-tab `storage` sync, and tolerance of an unavailable storage —
 * plus the shared label/hint copy the toggle and composer hint read.
 *
 * @module hooks/useGenerationMode.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  GENERATION_MODE_STORAGE_KEY,
  useGenerationModeCopy,
  usePreferredGenerationMode,
} from "./useGenerationMode";

// jsdom here ships no working localStorage (see AnnouncementBanner.test),
// so install a minimal in-memory one. `throwing` flips every call into
// an exception to model a private-mode browser.
const store = new Map<string, string>();
let throwing = false;
function guard<T>(fn: () => T): T {
  if (throwing) throw new Error("storage blocked");
  return fn();
}
const fake: Storage = {
  get length() {
    return store.size;
  },
  clear: () => guard(() => store.clear()),
  getItem: (k) => guard(() => (store.has(k) ? (store.get(k) as string) : null)),
  key: (i) => Array.from(store.keys())[i] ?? null,
  removeItem: (k) => guard(() => void store.delete(k)),
  setItem: (k, v) => guard(() => void store.set(k, String(v))),
};
Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true });

beforeEach(() => {
  store.clear();
  throwing = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePreferredGenerationMode", () => {
  it("defaults to advanced when nothing is stored", () => {
    const { result } = renderHook(() => usePreferredGenerationMode());
    expect(result.current[0]).toBe("advanced");
  });

  it("reads a stored simple preference", () => {
    window.localStorage.setItem(GENERATION_MODE_STORAGE_KEY, "simple");
    const { result } = renderHook(() => usePreferredGenerationMode());
    expect(result.current[0]).toBe("simple");
  });

  it("falls back to advanced for an unknown stored value", () => {
    window.localStorage.setItem(GENERATION_MODE_STORAGE_KEY, "ultra");
    const { result } = renderHook(() => usePreferredGenerationMode());
    expect(result.current[0]).toBe("advanced");
  });

  it("setMode updates state and persists", () => {
    const { result } = renderHook(() => usePreferredGenerationMode());
    act(() => result.current[1]("simple"));
    expect(result.current[0]).toBe("simple");
    expect(window.localStorage.getItem(GENERATION_MODE_STORAGE_KEY)).toBe("simple");
  });

  it("follows a storage event from another tab, ignoring other keys", () => {
    const { result } = renderHook(() => usePreferredGenerationMode());
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: GENERATION_MODE_STORAGE_KEY, newValue: "simple" }),
      );
    });
    expect(result.current[0]).toBe("simple");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "x" }));
    });
    expect(result.current[0]).toBe("simple");
    // A cleared / garbage value from another tab resets to the default.
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: GENERATION_MODE_STORAGE_KEY, newValue: null }),
      );
    });
    expect(result.current[0]).toBe("advanced");
  });

  it("keeps working when storage throws (private mode)", () => {
    throwing = true;
    const { result } = renderHook(() => usePreferredGenerationMode());
    expect(result.current[0]).toBe("advanced");
    act(() => result.current[1]("simple"));
    expect(result.current[0]).toBe("simple");
  });
});

describe("useGenerationModeCopy", () => {
  it("exposes the label + hint strings the toggle and composer hint render", () => {
    const { result } = renderHook(() => useGenerationModeCopy());
    expect(result.current.labels).toEqual({ simple: "Simple", advanced: "Advanced" });
    expect(result.current.hints.simple).toBe("SKILL.md only — no scripts, references or assets");
    expect(result.current.hints.advanced).toBe("SKILL.md plus scripts, references and assets");
  });
});
