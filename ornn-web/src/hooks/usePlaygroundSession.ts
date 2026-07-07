/**
 * usePlaygroundSession — page-level state hook for PlaygroundPage (#453).
 *
 * Pulls every query, ref, derived value, drawer state, and handler
 * callback out of the page so the page file is left with just the
 * layout shell + prop wiring.
 *
 * Owns:
 * - **Queries**: useSkill, useSkillPackage, useMyQuota, usePlaygroundChat.
 * - **Refs**: messagesEndRef + messagesScrollRef (scroll anchor + the
 *   scrollable container), chatInputRef (composer focus + setValue),
 *   stickToBottomRef (tracks whether the user has manually scrolled away
 *   from the live tail), closeTimerRef (drawer hover-close debounce).
 * - **Derived state**: skillCategory, previewMetadata, envVarKeys,
 *   needsEnvVars, allEnvVarsFilled, envIncomplete, playgroundSnap,
 *   isOverLimit, activeDrawer.
 * - **Local state**: envVars dict, pickedModelId, hoverDrawer,
 *   pinnedDrawer.
 * - **Effects**: scroll-stick listener, auto-scroll on new messages,
 *   Esc-to-unpin-drawer, auto-pin Env when incomplete, per-skill chat
 *   reset (clears chat + envVars + scroll state when skillName changes
 *   AND on unmount).
 * - **Handlers**: handleEnvVarChange, handleSend, handleStarterClick,
 *   openHover, scheduleHoverClose, togglePin.
 *
 * @module hooks/usePlaygroundSession
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ChatInputHandle } from "@/components/playground/ChatInput";
import {
  createDefaultSkillMetadata,
  type SkillMetadata,
} from "@/types/skillPackage";
import type { SkillCategory } from "@/utils/constants";
import { useSkill } from "@/hooks/useSkills";
import { useSkillPackage } from "@/hooks/useSkillPackage";
import { usePlaygroundChat } from "@/hooks/usePlaygroundChat";
import { useMyQuota } from "@/hooks/useQuota";
import {
  extractEnvVarKeys,
  isRuntimeBased,
} from "@/components/playground/PlaygroundHelpers.helpers";
import type { DrawerKey } from "@/components/playground/PlaygroundRail";

export function usePlaygroundSession(skillName: string | null) {
  const { data: skill, isLoading: skillLoading, error: skillError } = useSkill(skillName ?? "");
  const {
    files: packageFiles,
    fileContents: packageContents,
    isLoading: packageLoading,
  } = useSkillPackage(skill?.guid, skill?.version);

  // ── Env vars ────────────────────────────────────────────────────────
  const envVarKeys = useMemo(
    () => extractEnvVarKeys((skill?.metadata as Record<string, unknown>) ?? null),
    [skill?.metadata],
  );
  const needsEnvVars = useMemo(
    () =>
      isRuntimeBased((skill?.metadata as Record<string, unknown>) ?? null) &&
      envVarKeys.length > 0,
    [skill?.metadata, envVarKeys],
  );
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const allEnvVarsFilled = useMemo(() => {
    if (!needsEnvVars) return true;
    return envVarKeys.every((key) => envVars[key]?.trim());
  }, [needsEnvVars, envVarKeys, envVars]);
  const handleEnvVarChange = useCallback((key: string, value: string) => {
    setEnvVars((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Model picker ────────────────────────────────────────────────────
  const [pickedModelId, setPickedModelId] = useState<string | null>(null);

  // ── Quota ───────────────────────────────────────────────────────────
  const { data: quotaSnapshot } = useMyQuota();
  const playgroundSnap = quotaSnapshot?.playground;
  const isOverLimit =
    Boolean(playgroundSnap) && !quotaSnapshot?.isAdmin && playgroundSnap!.remaining <= 0;

  // ── Chat state (Zustand-backed via usePlaygroundChat) ───────────────
  const {
    messages,
    isStreaming,
    toolCallStatuses,
    fileOutputs,
    error,
    currentAssistantContent,
    sendMessage,
    abort,
    clearChat,
  } = usePlaygroundChat();

  // ── Scroll refs ─────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  // Tracks whether the user has manually scrolled away from the bottom.
  // While true, we do NOT yank them back on each token flush.
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distFromBottom < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll only when stick-to-bottom is on (i.e. user hasn't
  // scrolled up). Uses `auto` (instant) instead of `smooth` during
  // streaming because `smooth` queues animations and gets choppy with
  // 50ms-batched token flushes.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, currentAssistantContent]);

  // ── Send / starter handlers ────────────────────────────────────────
  const handleSend = useCallback(
    (content: string) => {
      sendMessage(
        content,
        skillName ?? undefined,
        needsEnvVars ? envVars : undefined,
        pickedModelId ?? undefined,
      );
    },
    [sendMessage, skillName, envVars, needsEnvVars, pickedModelId],
  );

  const handleStarterClick = useCallback((body: string) => {
    chatInputRef.current?.setValue(body);
  }, []);

  // ── Drawer state ────────────────────────────────────────────────────
  // `hover` = mouse is on a rail tab or inside the drawer (auto-close
  // when it leaves). `pinned` = clicked open; stays until clicked
  // again, click outside, or Esc.
  const [hoverDrawer, setHoverDrawer] = useState<DrawerKey | null>(null);
  const [pinnedDrawer, setPinnedDrawer] = useState<DrawerKey | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openHover = useCallback((key: DrawerKey) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHoverDrawer(key);
  }, []);
  const scheduleHoverClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setHoverDrawer(null);
      closeTimerRef.current = null;
    }, 220);
  }, []);
  const togglePin = useCallback((key: DrawerKey) => {
    setPinnedDrawer((cur) => (cur === key ? null : key));
    setHoverDrawer(null);
  }, []);

  // Close pinned drawer on Esc
  useEffect(() => {
    if (!pinnedDrawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinnedDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinnedDrawer]);

  // Auto-pin Env when env vars are missing — the user MUST fill them
  // before chatting, so make it obvious without forcing them to discover
  // the drawer hint.
  const envIncomplete = needsEnvVars && !allEnvVarsFilled;
  useEffect(() => {
    if (envIncomplete) setPinnedDrawer("env");
  }, [envIncomplete]);

  // ── Per-skill session lifecycle ────────────────────────────────────
  // Each Playground visit (and each switch between skills) starts a
  // fresh chat. Without this, the Zustand store carries stale messages
  // across navigation — confusing UX and breaking any per-session
  // analytics that assume a session begins on mount.
  useEffect(() => {
    clearChat();
    setEnvVars({});
    stickToBottomRef.current = true;
    return () => {
      clearChat();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillName]);

  const activeDrawer = pinnedDrawer ?? hoverDrawer;

  const skillCategory = (skill?.metadata as Record<string, unknown> | null)?.category as
    | string
    | undefined;

  // Synthesise a SkillMetadata-shaped object from the registry skill
  // record so SkillPackagePreview can render the same flat identity
  // strip as the generative page. The preview only reads name /
  // description / category / tag, so we don't need to faithfully
  // reproduce the rest of the shape — `createDefaultSkillMetadata` fills
  // the unused fields with safe defaults. Declared above the early-
  // return guards so the hook order is stable.
  const previewMetadata = useMemo<SkillMetadata | null>(() => {
    if (!skill) return null;
    return createDefaultSkillMetadata({
      name: skill.name,
      description: skill.description ?? "",
      version: skill.version,
      metadata: {
        category: (skillCategory as SkillCategory) ?? "plain",
        runtime: [],
        runtimeDependency: [],
        runtimeEnvVar: [],
        toolList: [],
        tag: skill.tags ?? [],
      },
    });
  }, [skill, skillCategory]);

  return {
    // ── queries ──
    skill,
    skillLoading,
    skillError,
    packageFiles,
    packageContents,
    packageLoading,
    quotaSnapshot,
    playgroundSnap,
    isOverLimit,
    // ── chat ──
    messages,
    isStreaming,
    toolCallStatuses,
    fileOutputs,
    error,
    currentAssistantContent,
    abort,
    clearChat,
    // ── refs ──
    messagesEndRef,
    messagesScrollRef,
    chatInputRef,
    // ── env ──
    envVarKeys,
    needsEnvVars,
    envVars,
    allEnvVarsFilled,
    envIncomplete,
    handleEnvVarChange,
    // ── send + starter ──
    handleSend,
    handleStarterClick,
    // ── model ──
    pickedModelId,
    setPickedModelId,
    // ── drawer ──
    hoverDrawer,
    setHoverDrawer,
    pinnedDrawer,
    setPinnedDrawer,
    activeDrawer,
    openHover,
    scheduleHoverClose,
    togglePin,
    // ── derived ──
    previewMetadata,
  };
}

export type PlaygroundSession = ReturnType<typeof usePlaygroundSession>;
