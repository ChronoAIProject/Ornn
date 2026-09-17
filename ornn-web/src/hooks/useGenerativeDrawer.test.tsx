/**
 * UT-WEB-GENERATIVE-DRAWER-001 (#1242)
 *
 * Pins the drawer state machine extracted from CreateSkillGenerativePage:
 * pinned-open by default, hover open / delayed close, Esc unpins, and
 * the new-iteration hint that flips on the `generating → preview` edge
 * only while the drawer is closed and clears as soon as it opens.
 *
 * @module hooks/useGenerativeDrawer.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useGenerativeDrawer } from "./useGenerativeDrawer";
import type { GenerationPhase } from "@/types/skillPackage";

describe("useGenerativeDrawer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts pinned open", () => {
    const { result } = renderHook(() => useGenerativeDrawer("input"));
    expect(result.current.pinnedOpen).toBe(true);
    expect(result.current.drawerOpen).toBe(true);
  });

  it("togglePin closes a pinned drawer and re-opens it", () => {
    const { result } = renderHook(() => useGenerativeDrawer("input"));
    act(() => result.current.togglePin());
    expect(result.current.pinnedOpen).toBe(false);
    expect(result.current.drawerOpen).toBe(false);
    act(() => result.current.togglePin());
    expect(result.current.drawerOpen).toBe(true);
  });

  it("hover opens an unpinned drawer and closes after the delay", () => {
    const { result } = renderHook(() => useGenerativeDrawer("input"));
    act(() => result.current.unpin());
    expect(result.current.drawerOpen).toBe(false);

    act(() => result.current.openHover());
    expect(result.current.drawerOpen).toBe(true);

    act(() => result.current.scheduleHoverClose());
    // Still open until the close delay elapses.
    expect(result.current.drawerOpen).toBe(true);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.drawerOpen).toBe(false);
  });

  it("re-entering during the close delay cancels the pending close", () => {
    const { result } = renderHook(() => useGenerativeDrawer("input"));
    act(() => result.current.unpin());
    act(() => result.current.openHover());
    act(() => result.current.scheduleHoverClose());
    act(() => result.current.openHover());
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.drawerOpen).toBe(true);
  });

  it("close() clears both pin and hover state", () => {
    const { result } = renderHook(() => useGenerativeDrawer("input"));
    act(() => result.current.openHover());
    act(() => result.current.close());
    expect(result.current.pinnedOpen).toBe(false);
    expect(result.current.drawerOpen).toBe(false);
  });

  it("Escape unpins a pinned drawer", () => {
    const { result } = renderHook(() => useGenerativeDrawer("input"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.pinnedOpen).toBe(false);
  });

  it("flags an unseen iteration only when a generation lands while closed, and clears on open", () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: GenerationPhase }) => useGenerativeDrawer(phase),
      { initialProps: { phase: "input" as GenerationPhase } },
    );

    // Drawer open (default): a landed generation is NOT unseen.
    rerender({ phase: "generating" });
    rerender({ phase: "preview" });
    expect(result.current.hasUnseenIteration).toBe(false);

    // Close, then run another generation → flagged.
    act(() => result.current.unpin());
    rerender({ phase: "generating" });
    rerender({ phase: "preview" });
    expect(result.current.hasUnseenIteration).toBe(true);

    // Opening the drawer clears the hint.
    act(() => result.current.togglePin());
    expect(result.current.drawerOpen).toBe(true);
    expect(result.current.hasUnseenIteration).toBe(false);
  });

  it("does not flag an error transition as an unseen iteration", () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: GenerationPhase }) => useGenerativeDrawer(phase),
      { initialProps: { phase: "input" as GenerationPhase } },
    );
    act(() => result.current.unpin());
    rerender({ phase: "generating" });
    rerender({ phase: "error" });
    expect(result.current.hasUnseenIteration).toBe(false);
  });
});
