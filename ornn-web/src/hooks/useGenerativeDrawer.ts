/**
 * Drawer state for the generative skill builder (#1242 decomposition of
 * CreateSkillGenerativePage).
 *
 * Same hover / pin primitive as the playground drawer, but the package
 * drawer is **pinned open by default** because the preview IS the work
 * product. Also owns the "new iteration" hint: the chat lets the user
 * refine across many turns, so each `generating → preview` transition
 * produces a fresh package; when that lands while the drawer is closed
 * the rail tab pulses so the user notices without scrolling.
 *
 * @module hooks/useGenerativeDrawer
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationPhase } from "@/types/skillPackage";

/** Delay before a hover-opened drawer closes after the pointer leaves. */
const HOVER_CLOSE_DELAY_MS = 220;

export interface UseGenerativeDrawerReturn {
  /** True when either pinned or hover-opened. */
  drawerOpen: boolean;
  pinnedOpen: boolean;
  /** A generation landed while the drawer was closed and hasn't been seen. */
  hasUnseenIteration: boolean;
  openHover: () => void;
  scheduleHoverClose: () => void;
  togglePin: () => void;
  /** Close regardless of how it was opened. */
  close: () => void;
  unpin: () => void;
}

export function useGenerativeDrawer(phase: GenerationPhase): UseGenerativeDrawerReturn {
  const [hoverDrawerOpen, setHoverDrawerOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openHover = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHoverDrawerOpen(true);
  }, []);

  const scheduleHoverClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setHoverDrawerOpen(false);
      closeTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, []);

  const togglePin = useCallback(() => {
    setPinnedOpen((cur) => !cur);
    setHoverDrawerOpen(false);
  }, []);

  const close = useCallback(() => {
    setPinnedOpen(false);
    setHoverDrawerOpen(false);
  }, []);

  const unpin = useCallback(() => setPinnedOpen(false), []);

  // Esc closes a pinned drawer.
  useEffect(() => {
    if (!pinnedOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinnedOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinnedOpen]);

  const drawerOpen = pinnedOpen || hoverDrawerOpen;

  // Both transitions use the "adjust state during render" guard rather
  // than a setState inside an effect (avoids the cascading render the
  // react-hooks lint flags, #888): the flag flips on the
  // `generating → preview` edge while closed, and clears on the
  // `closed → open` edge.
  const [hasUnseenIteration, setHasUnseenIteration] = useState(false);
  const [prevPhase, setPrevPhase] = useState(phase);
  if (phase !== prevPhase) {
    setPrevPhase(phase);
    if (prevPhase === "generating" && phase === "preview" && !drawerOpen) {
      setHasUnseenIteration(true);
    }
  }
  const [prevDrawerOpen, setPrevDrawerOpen] = useState(drawerOpen);
  if (drawerOpen !== prevDrawerOpen) {
    setPrevDrawerOpen(drawerOpen);
    if (drawerOpen) setHasUnseenIteration(false);
  }

  return {
    drawerOpen,
    pinnedOpen,
    hasUnseenIteration,
    openHover,
    scheduleHoverClose,
    togglePin,
    close,
    unpin,
  };
}
