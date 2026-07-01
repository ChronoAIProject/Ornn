/**
 * useSourceDriftProbe tests (#1178) — the lazy on-view drift refetch fires at
 * most once, only when stale, only for github sources, and never via a timer.
 *
 * @module hooks/useSourceDriftProbe.test
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSourceDriftProbe, SOURCE_DRIFT_STALE_MS } from "./useSourceDriftProbe";
import type { SkillSource } from "@/types/domain";

function gh(lastCheckedAt?: string): SkillSource {
  return {
    type: "github",
    repo: "o/r",
    ref: "main",
    path: "",
    ...(lastCheckedAt ? { lastCheckedAt } : {}),
  };
}

const staleIso = () => new Date(Date.now() - SOURCE_DRIFT_STALE_MS - 60_000).toISOString();
const freshIso = () => new Date().toISOString();

describe("useSourceDriftProbe", () => {
  it("refetches once when lastCheckedAt is stale", () => {
    const refetch = vi.fn();
    const source = gh(staleIso());
    renderHook(() => useSourceDriftProbe(source, refetch));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("refetches when the source was never checked (no lastCheckedAt)", () => {
    const refetch = vi.fn();
    renderHook(() => useSourceDriftProbe(gh(), refetch));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT refetch when the last check is fresh", () => {
    const refetch = vi.fn();
    renderHook(() => useSourceDriftProbe(gh(freshIso()), refetch));
    expect(refetch).not.toHaveBeenCalled();
  });

  it("does NOT refetch for a non-github / undefined source", () => {
    const refetch = vi.fn();
    renderHook(() => useSourceDriftProbe(undefined, refetch));
    expect(refetch).not.toHaveBeenCalled();
  });

  it("fires at most once even across re-renders with a new source object", () => {
    const refetch = vi.fn();
    const { rerender } = renderHook(({ s }) => useSourceDriftProbe(s, refetch), {
      initialProps: { s: gh(staleIso()) },
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    // New (still-stale) object → deps change, but the ref guard prevents a re-fire.
    rerender({ s: gh(staleIso()) });
    rerender({ s: gh(staleIso()) });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
