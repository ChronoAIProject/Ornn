/**
 * Playground Page — chat is the page, context lives in a slide-in drawer.
 *
 * Layout:
 *   - Chat occupies the full viewport (ChatGPT-style centered column).
 *   - Skill / Env / Package context lives in a slide-in drawer on the
 *     right that overlays the chat. Triggered by hover on the right-edge
 *     rail (3 stacked tabs), or pinned open with a click. Clicking
 *     outside (or pressing Esc) closes a non-pinned drawer.
 *
 * Streaming UX:
 *   - Immediate "thinking" pulse the moment `isStreaming` flips on.
 *   - Token-by-token caret on the live assistant message via the
 *     standard `ChatMessage` (animate-blink). If responses still land
 *     all at once, the upstream LLM gateway is buffering — verifiable
 *     in DevTools → Network → playground/chat → EventStream.
 *
 * @module pages/PlaygroundPage
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/Skeleton";
import { motion, AnimatePresence } from "framer-motion";
import { PageTransition } from "@/components/layout/PageTransition";
import { ChatInput, type ChatInputHandle } from "@/components/playground/ChatInput";
import { ModelPicker } from "@/components/models/ModelPicker";
import { OverLimitPage } from "@/components/quota/OverLimitPage";
import { QuotaInline } from "@/components/quota/QuotaInline";
import { EnvIcon, PackageIcon } from "@/components/icons";
import {
  createDefaultSkillMetadata,
  type SkillMetadata,
} from "@/types/skillPackage";
import type { SkillCategory } from "@/utils/constants";
import { useSkill } from "@/hooks/useSkills";
import { useSkillPackage } from "@/hooks/useSkillPackage";
import { usePlaygroundChat } from "@/hooks/usePlaygroundChat";
import { useMyQuota } from "@/hooks/useQuota";
import { useTranslation } from "react-i18next";
import {
  extractEnvVarKeys,
  isRuntimeBased,
  defaultPromptStarters,
} from "@/components/playground/PlaygroundHelpers";
import { PlaygroundEmptyHero } from "@/components/playground/PlaygroundEmptyHero";
import { PlaygroundEnvDrawerBody } from "@/components/playground/PlaygroundEnvDrawerBody";
import { PlaygroundPackageDrawerBody } from "@/components/playground/PlaygroundPackageDrawerBody";
import {
  PlaygroundRail,
  type DrawerKey,
  type PlaygroundRailTab,
} from "@/components/playground/PlaygroundRail";
import { PlaygroundConversation } from "@/components/playground/PlaygroundConversation";


export function PlaygroundPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const skillName = searchParams.get("skill");

  const { data: skill, isLoading: skillLoading, error: skillError } = useSkill(skillName ?? "");
  const {
    files: packageFiles,
    fileContents: packageContents,
    isLoading: packageLoading,
  } = useSkillPackage(skill?.presignedPackageUrl);

  const envVarKeys = useMemo(() => extractEnvVarKeys(skill?.metadata as Record<string, unknown> ?? null), [skill?.metadata]);
  const needsEnvVars = useMemo(() => isRuntimeBased(skill?.metadata as Record<string, unknown> ?? null) && envVarKeys.length > 0, [skill?.metadata, envVarKeys]);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});

  const allEnvVarsFilled = useMemo(() => {
    if (!needsEnvVars) return true;
    return envVarKeys.every((key) => envVars[key]?.trim());
  }, [needsEnvVars, envVarKeys, envVars]);

  const handleEnvVarChange = useCallback((key: string, value: string) => {
    setEnvVars((prev) => ({ ...prev, [key]: value }));
  }, []);

  const [pickedModelId, setPickedModelId] = useState<string | null>(null);

  const { data: quotaSnapshot } = useMyQuota();
  const playgroundSnap = quotaSnapshot?.playground;
  const isOverLimit =
    Boolean(playgroundSnap) &&
    !quotaSnapshot?.isAdmin &&
    playgroundSnap!.remaining <= 0;

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  // Tracks whether the user has manually scrolled away from the bottom.
  // While true, we do NOT yank them back on each token flush.
  const stickToBottomRef = useRef(true);

  // Detect manual scroll-away: if the scrollbar is more than ~80px from
  // the bottom we stop auto-scrolling. The user can return to live
  // tailing by scrolling back to the bottom.
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

  const handleSend = useCallback((content: string) => {
    sendMessage(
      content,
      skillName ?? undefined,
      needsEnvVars ? envVars : undefined,
      pickedModelId ?? undefined,
    );
  }, [sendMessage, skillName, envVars, needsEnvVars, pickedModelId]);

  const handleStarterClick = useCallback((body: string) => {
    chatInputRef.current?.setValue(body);
  }, []);

  // ── Drawer state ──
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

  // ── Per-skill session lifecycle ──
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

  const skillCategory = (skill?.metadata as Record<string, unknown> | null)?.category as string | undefined;

  // Synthesise a SkillMetadata-shaped object from the registry skill record
  // so SkillPackagePreview can render the same flat identity strip as the
  // generative page. The preview only reads name / description / category /
  // tag, so we don't need to faithfully reproduce the rest of the shape —
  // `createDefaultSkillMetadata` fills the unused fields with safe defaults.
  // Declared above the early-return guards so the hook order is stable.
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

  // No skill specified
  if (!skillName) {
    return (
      <PageTransition>
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="mb-4 font-text text-sm text-meta">
              {t("playground.selectSkill")}
            </p>
            <Link to="/registry" className="font-text text-sm text-accent hover:underline">
              {t("playground.browseSkills")}
            </Link>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (skillLoading) {
    return (
      <PageTransition>
        <div className="flex h-full items-center justify-center">
          <Skeleton lines={4} />
        </div>
      </PageTransition>
    );
  }

  // After loading: no skill data means the caller doesn't have access
  // (404 SKILL_NOT_FOUND on a private skill they aren't allowed to see),
  // OR the slug is bogus. Either way, render the not-found state —
  // never the playground UI (#563). Without this gate, starter prompts
  // and the chat input were rendering for unauthorized users even
  // though every API call would 404.
  if (skillError || !skill) {
    return (
      <PageTransition>
        <div className="flex h-full items-center justify-center">
          <div className="text-center max-w-md">
            <p className="mb-2 font-display text-lg text-strong">
              {t("playground.notFoundTitle", "Skill not found")}
            </p>
            <p className="mb-4 font-text text-sm text-meta">
              {t(
                "playground.notFoundBody",
                "This skill doesn't exist, or you don't have access to it.",
              )}
            </p>
            <Link to="/registry" className="font-text text-sm text-accent hover:underline">
              {t("playground.browseSkills")}
            </Link>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (isOverLimit && playgroundSnap && quotaSnapshot) {
    return (
      <PageTransition>
        <OverLimitPage
          surface="playground"
          snapshot={playgroundSnap}
          resetAt={quotaSnapshot.nextMonthlyResetAt}
        />
      </PageTransition>
    );
  }

  const starters = defaultPromptStarters(skillName, t);
  const conversationActive = messages.length > 0 || !!currentAssistantContent || isStreaming;

  // Right-edge rail tabs. Each tab renders as a compact icon handle —
  // the `tip` is a horizontal mono-uppercase label shown on hover (matches
  // the drawer header `[§ NAME]` voice). The Package drawer now hosts the
  // skill identity (name + category + tags + description) at the top of
  // `SkillPackagePreview`, so a separate Skill tab would be redundant.
  const railTabs: PlaygroundRailTab[] = [
    ...(needsEnvVars
      ? [
          {
            key: "env" as const,
            ariaLabel: t("aria.playgroundEnvDrawer"),
            tip: "ENV",
            Icon: EnvIcon,
            warn: envIncomplete,
          },
        ]
      : []),
    {
      key: "package",
      ariaLabel: t("aria.skillPackageDrawer"),
      tip: "PACKAGE",
      Icon: PackageIcon,
    },
  ];

  return (
    <PageTransition>
      <div className="relative flex h-full flex-col">
        {/* Quota chip is already surfaced by the app shell; the model
            picker has moved down to sit just above the composer (same
            place ChatGPT puts it). No surface header needed. */}

        {/* ─── Chat (page hero) ─── */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pb-6 pt-1">
            {/* Slim utility row — only when a conversation is active.
                A pulsing ember dot shows streaming; clear-chat sits as a
                small ghost link on the right. No "Idle/Ready" status
                noise to compete with the conversation itself. */}
            {conversationActive && (
              <div className="mb-1 flex shrink-0 items-center justify-between py-1">
                <span
                  aria-hidden
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    isStreaming ? "animate-pulse bg-accent" : "bg-transparent"
                  }`}
                />
                <button
                  type="button"
                  onClick={clearChat}
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta transition-colors hover:text-accent"
                >
                  {t("playground.clearChat")}
                </button>
              </div>
            )}

            {/* Messages scroll area */}
            <div ref={messagesScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
              {!conversationActive ? (
                <PlaygroundEmptyHero
                  skillName={skillName}
                  envIncomplete={envIncomplete}
                  starters={starters}
                  onStarterClick={handleStarterClick}
                />
              ) : (
                <PlaygroundConversation
                  ref={messagesEndRef}
                  messages={messages}
                  isStreaming={isStreaming}
                  toolCallStatuses={toolCallStatuses}
                  currentAssistantContent={currentAssistantContent}
                  fileOutputs={fileOutputs}
                  error={error}
                />
              )}
            </div>

            {/* Chat input — pinned bottom */}
            {/* Composer — model picker above the input, ChatGPT-style.
                Both elements share the chat column's centerline so the
                empty-state hero, the conversation, and the composer all
                line up vertically without "one looks shifted". */}
            <div className="shrink-0 pt-3">
              <div className="mb-2 flex items-center justify-center gap-3">
                <QuotaInline surface="playground" />
                <ModelPicker surface="playground" onChange={setPickedModelId} />
              </div>
              <ChatInput
                ref={chatInputRef}
                onSend={handleSend}
                onAbort={abort}
                disabled={isStreaming || envIncomplete}
                isStreaming={isStreaming}
                placeholder={
                  envIncomplete
                    ? t("playground.fillFirst")
                    : isStreaming
                      ? t("chatInput.generating", "Generating…")
                      : t("playground.askPlaceholder", { name: skillName })
                }
              />
              <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-meta/70">
                {t("playground.kbHint", "Enter to send · Shift + Enter for newline")}
              </p>
            </div>
          </div>
        </section>

        {/* ─── Right-edge rail (always visible — anchored to viewport
            so it stays put when the page scrolls) ─── */}
        <PlaygroundRail
          tabs={railTabs}
          activeDrawer={activeDrawer}
          pinnedDrawer={pinnedDrawer}
          onHoverOpen={openHover}
          onHoverCloseScheduled={scheduleHoverClose}
          onTogglePin={togglePin}
        />

        {/* ─── Drawer overlay ─── */}
        <AnimatePresence>
          {activeDrawer && (
            <>
              {/* Backdrop — only when pinned (so hover-peek doesn't dim
                  the chat). Click backdrop to unpin. */}
              {pinnedDrawer && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setPinnedDrawer(null)}
                  className="fixed inset-0 z-30 bg-page/40 backdrop-blur-[1px]"
                />
              )}

              <motion.aside
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                onMouseEnter={() => openHover(activeDrawer)}
                onMouseLeave={scheduleHoverClose}
                className="card-impression fixed right-10 top-[68px] bottom-4 z-40 flex w-[min(960px,65vw)] max-w-[calc(100vw-3rem)] flex-col rounded-md border border-subtle bg-card"
                role="complementary"
                aria-label={`${activeDrawer} panel`}
              >
                {/* Drawer header */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-subtle bg-elevated/50 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                      [§&nbsp;{activeDrawer.toUpperCase()}]
                    </span>
                    {pinnedDrawer && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                        {t("playground.pinned", "Pinned")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => togglePin(activeDrawer)}
                      className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta transition-colors hover:text-accent"
                    >
                      {pinnedDrawer === activeDrawer
                        ? t("playground.unpin", "Unpin")
                        : t("playground.pin", "Pin")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPinnedDrawer(null);
                        setHoverDrawer(null);
                      }}
                      aria-label={t("common.aria.closeDrawer")}
                      className="font-mono text-[12px] text-meta transition-colors hover:text-accent"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Drawer body */}
                <div className="flex min-h-0 flex-1 flex-col">
                  {activeDrawer === "env" && needsEnvVars && (
                    <PlaygroundEnvDrawerBody
                      envVarKeys={envVarKeys}
                      envVars={envVars}
                      allEnvVarsFilled={allEnvVarsFilled}
                      onEnvVarChange={handleEnvVarChange}
                    />
                  )}

                  {activeDrawer === "package" && (
                    <PlaygroundPackageDrawerBody
                      packageLoading={packageLoading}
                      packageFiles={packageFiles}
                      packageContents={packageContents}
                      previewMetadata={previewMetadata}
                      skill={skill}
                    />
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}
