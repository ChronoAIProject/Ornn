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

import { useState, useRef, useEffect, useMemo, useCallback, type ComponentType } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { PageTransition } from "@/components/layout/PageTransition";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { ChatInput, type ChatInputHandle } from "@/components/playground/ChatInput";
import { ChatMessage } from "@/components/playground/ChatMessage";
import { SkillPackagePreview } from "@/components/skill/SkillPackagePreview";
import { ModelPicker } from "@/components/models/ModelPicker";
import { OverLimitPage } from "@/components/quota/OverLimitPage";
import { QuotaInline } from "@/components/quota/QuotaInline";
import { SkillIcon, EnvIcon, PackageIcon, type IconProps } from "@/components/icons";
import { useSkill } from "@/hooks/useSkills";
import { useSkillPackage } from "@/hooks/useSkillPackage";
import { usePlaygroundChat } from "@/hooks/usePlaygroundChat";
import { useMyQuota } from "@/hooks/useQuota";
import { useTranslation } from "react-i18next";

/** Extract env var keys from skill metadata */
function extractEnvVarKeys(metadata: Record<string, unknown> | null): string[] {
  if (!metadata) return [];
  const runtimes = metadata.runtimes as Array<{ envs?: Array<{ var: string }> }> | undefined;
  if (!runtimes?.length) return [];
  const keys: string[] = [];
  for (const rt of runtimes) {
    if (rt.envs) {
      for (const env of rt.envs) {
        if (env.var && !keys.includes(env.var)) {
          keys.push(env.var);
        }
      }
    }
  }
  return keys;
}

/** Check if skill is runtime-based */
function isRuntimeBased(metadata: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  const category = metadata.category as string;
  return category === "runtime-based" || category === "mixed";
}

/** Pre-token streaming indicator — three pulsing ember dots, spring-in. */
function ThinkingBubble() {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 320, damping: 28, mass: 0.6 }}
      className="flex justify-start"
    >
      <div className="rounded-2xl border border-subtle bg-card px-4 py-3">
        <div className="flex items-center gap-1.5" aria-label={t("aria.generating")}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "0ms" }} />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "150ms" }} />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </motion.div>
  );
}

/** Welded-seam horizontal divider with a rivet dot in the middle. */
function WeldedSeam({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`} aria-hidden>
      <span className="h-px flex-1 bg-strong-edge/40" />
      <span className="h-1 w-1 rounded-full bg-accent/40" />
      <span className="h-px flex-1 bg-strong-edge/40" />
    </div>
  );
}

interface PromptStarter {
  label: string;
  body: string;
}

type TFunc = ReturnType<typeof import("react-i18next").useTranslation>["t"];

function defaultPromptStarters(skillName: string, t: TFunc): PromptStarter[] {
  return [
    {
      label: t("playground.starter1Label", "Walk me through it"),
      body: t("playground.starter1Body", "Walk me through what `{{name}}` does and the main ways I'd use it.", {
        name: skillName,
      }),
    },
    {
      label: t("playground.starter2Label", "Show an example"),
      body: t("playground.starter2Body", "Give me a concrete usage example for `{{name}}` — make up sample input and run it.", {
        name: skillName,
      }),
    },
    {
      label: t("playground.starter3Label", "List capabilities"),
      body: t("playground.starter3Body", "List every capability `{{name}}` exposes, with a one-line description for each.", {
        name: skillName,
      }),
    },
  ];
}

type DrawerKey = "skill" | "package" | "env";

export function PlaygroundPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const skillName = searchParams.get("skill");

  const { data: skill, isLoading: skillLoading } = useSkill(skillName ?? "");
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

  const skillCategory = (skill?.metadata as Record<string, unknown> | null)?.category as string | undefined;
  const starters = defaultPromptStarters(skillName, t);
  const conversationActive = messages.length > 0 || !!currentAssistantContent || isStreaming;

  // Right-edge rail tabs. Each tab renders as a compact icon handle —
  // the `tip` is a horizontal mono-uppercase label shown on hover (matches
  // the drawer header `[§ NAME]` voice). Avoids vertical-text rotation
  // which renders CJK upside-down.
  const railTabs: Array<{
    key: DrawerKey;
    label: string;
    tip: string;
    Icon: ComponentType<IconProps>;
    warn?: boolean;
  }> = [
    {
      key: "skill",
      label: t("playground.tabSkill", "Skill"),
      tip: "SKILL",
      Icon: SkillIcon,
    },
    ...(needsEnvVars
      ? [
          {
            key: "env" as const,
            label: t("playground.tabEnv", "Env"),
            tip: "ENV",
            Icon: EnvIcon,
            warn: envIncomplete,
          },
        ]
      : []),
    {
      key: "package",
      label: t("playground.tabPackage", "Package"),
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
                /* ─── Empty-state hero ─── ChatGPT-style centered prompt
                    flag with skill identity, single-line lede, and three
                    starters as soft chips below. Vertical-centered so
                    the cursor lands ~middle of the screen at rest. */
                <div className="flex h-full flex-col items-center justify-center py-8">
                  <div className="w-full space-y-6 text-center">
                    <div className="space-y-2">
                      <div className="font-mono text-[10px] uppercase tracking-[0.20em] text-meta">
                        {skillName}
                      </div>
                      <h2 className="font-display text-3xl font-semibold leading-[1.15] tracking-tight text-strong">
                        {t("playground.heroTitle", "Probe the skill.")}
                      </h2>
                      <p className="font-text text-[15px] leading-relaxed text-body">
                        {envIncomplete
                          ? t(
                              "playground.heroEnvFirst",
                              "Set the runtime env vars in the Env drawer on the right, then start chatting.",
                            )
                          : t(
                              "playground.heroSubtitle",
                              "Ask anything about {{name}}, or have it run with sample input.",
                              { name: skillName },
                            )}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {starters.map((s) => (
                        <button
                          key={s.label}
                          type="button"
                          onClick={() => handleStarterClick(s.body)}
                          disabled={envIncomplete}
                          className="group flex flex-col items-start gap-1 rounded-xl border border-subtle bg-card/60 px-3.5 py-3 text-left transition-all hover:border-accent/60 hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                            {s.label}
                          </span>
                          <span className="line-clamp-2 font-text text-[13px] leading-snug text-body">
                            {s.body}
                          </span>
                        </button>
                      ))}
                    </div>

                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta/70">
                      {t(
                        "playground.drawerHint",
                        "Skill · Env · Package on the right edge",
                      )}
                    </p>
                  </div>
                </div>
              ) : (
                /* ─── Conversation ─── */
                <div className="space-y-3 py-3">
                  {messages.map((msg, idx) => {
                    const isLastAssistant =
                      msg.role === "assistant" &&
                      idx === messages.length - 1 &&
                      isStreaming;
                    return (
                      <ChatMessage
                        key={msg.id}
                        message={msg}
                        toolCallStatuses={toolCallStatuses}
                        isStreaming={isLastAssistant}
                      />
                    );
                  })}

                  {currentAssistantContent && (
                    <ChatMessage
                      message={{
                        id: "streaming-buffer",
                        role: "assistant",
                        content: currentAssistantContent,
                      }}
                      toolCallStatuses={toolCallStatuses}
                      isStreaming
                    />
                  )}

                  {isStreaming && !currentAssistantContent && <ThinkingBubble />}

                  {fileOutputs.map((file, idx) => (
                    <div key={`file-${idx}`} className="flex justify-start">
                      <div className="max-w-[88%] rounded-sm border border-subtle bg-card p-2.5">
                        {file.mimeType.startsWith("image/") ? (
                          <div>
                            <img
                              src={`data:${file.mimeType};base64,${file.content}`}
                              alt={file.path}
                              className="max-w-full rounded-sm"
                            />
                            <p className="mt-1.5 font-mono text-[10px] text-meta">{file.path} ({Math.round(file.size / 1024)}KB)</p>
                          </div>
                        ) : (
                          <a
                            href={`data:${file.mimeType};base64,${file.content}`}
                            download={file.path.split("/").pop()}
                            className="font-mono text-xs text-accent hover:underline"
                          >
                            {file.path} ({Math.round(file.size / 1024)}KB)
                          </a>
                        )}
                      </div>
                    </div>
                  ))}

                  {error && (
                    <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2.5">
                      <p className="font-text text-xs text-danger">{error}</p>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
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
        <div
          className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1"
          onMouseLeave={scheduleHoverClose}
        >
          {railTabs.map((tab) => {
            const active = activeDrawer === tab.key;
            const Icon = tab.Icon;
            return (
              <button
                key={tab.key}
                type="button"
                onMouseEnter={() => openHover(tab.key)}
                onClick={() => togglePin(tab.key)}
                className={`group relative flex h-11 w-9 items-center justify-center rounded-l-sm border-y border-l transition-colors ${
                  active
                    ? "border-accent/60 bg-card text-accent"
                    : "border-subtle bg-card/80 text-meta hover:border-accent/40 hover:text-strong"
                }`}
                aria-label={`${tab.label} drawer`}
              >
                <Icon className="h-4 w-4" />

                {/* Horizontal tooltip — fades in on hover when the drawer
                    for this tab is not already open. Matches the drawer
                    header voice `[§ NAME]`. */}
                {!active && (
                  <span
                    className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-sm border border-subtle bg-card px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-strong opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    aria-hidden
                  >
                    [§&nbsp;{tab.tip}]
                  </span>
                )}

                {tab.warn && (
                  <span
                    className="absolute -left-1 top-1.5 h-1.5 w-1.5 rounded-full bg-warning"
                    aria-hidden
                  />
                )}
                {pinnedDrawer === tab.key && (
                  <span
                    className="absolute -left-px inset-y-2 w-px bg-accent"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>

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
                className="card-impression fixed right-10 top-4 bottom-4 z-40 flex w-[420px] max-w-[calc(100vw-3rem)] flex-col rounded-md border border-subtle bg-card"
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
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {activeDrawer === "skill" && skill && (
                    <div className="space-y-4 p-4">
                      <div className="flex items-start gap-3">
                        <div
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-strong-edge bg-warning-soft text-accent"
                          aria-hidden
                        >
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="16 18 22 12 16 6" />
                            <polyline points="8 6 2 12 8 18" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h2 className="break-words font-display text-base font-semibold leading-tight tracking-tight text-strong">
                            {skill.name}
                          </h2>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="inline-flex items-center rounded-sm border border-strong-edge px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-strong">
                              v{skill.version}
                            </span>
                            {skillCategory && (
                              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                                {skillCategory}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {skill.description && (
                        <>
                          <WeldedSeam />
                          <div>
                            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                              {t("playground.aboutThisSkill", "About")}
                            </div>
                            <p className="break-words font-text text-sm leading-relaxed text-body">
                              {skill.description}
                            </p>
                          </div>
                        </>
                      )}

                      {skill.tags && skill.tags.length > 0 && (
                        <>
                          <WeldedSeam />
                          <div>
                            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                              {t("playground.tags", "Tags")}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {skill.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center rounded-sm border border-subtle bg-elevated/40 px-1.5 py-0.5 font-mono text-[10px] text-body"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </>
                      )}

                      <WeldedSeam />
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
                          {t("playground.openDetail", "Skill page")}
                        </span>
                        <Link
                          to={`/skills/${encodeURIComponent(skill.name)}`}
                          className="font-mono text-[11px] text-accent hover:underline"
                        >
                          /skills/{skill.name} →
                        </Link>
                      </div>
                    </div>
                  )}

                  {activeDrawer === "env" && needsEnvVars && (
                    <div className="space-y-4 p-4">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                          {t("playground.envVars")}
                        </div>
                        <p className="mt-1 font-text text-xs leading-relaxed text-body">
                          {t("playground.envVarsDesc")}
                        </p>
                      </div>
                      <WeldedSeam />
                      <div className="space-y-3">
                        {envVarKeys.map((key) => (
                          <div key={key} className="space-y-1">
                            <div className="flex items-center justify-between">
                              <label className="block max-w-full truncate font-mono text-[11px] text-strong" title={key}>
                                {key}
                              </label>
                              {envVars[key]?.trim() ? (
                                <Badge color="green">{t("common.set")}</Badge>
                              ) : (
                                <Badge color="cyan">{t("common.required")}</Badge>
                              )}
                            </div>
                            <input
                              type="text"
                              value={envVars[key] ?? ""}
                              onChange={(e) => handleEnvVarChange(key, e.target.value)}
                              placeholder={t("playground.enterValue")}
                              className="w-full rounded-sm border border-subtle bg-page px-2.5 py-1.5 font-mono text-xs text-strong placeholder:text-meta/50 focus:border-accent/60 focus:outline-none"
                            />
                          </div>
                        ))}
                      </div>
                      {!allEnvVarsFilled && (
                        <>
                          <WeldedSeam />
                          <p className="font-text text-[11px] leading-relaxed text-meta">
                            {t(
                              "playground.envVarsLockHint",
                              "Chat is locked until every required env var has a value.",
                            )}
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {activeDrawer === "package" && (
                    <div className="flex h-full flex-col">
                      <div className="flex shrink-0 items-center justify-between border-b border-subtle px-4 py-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-meta">
                          {skill ? `${skill.name}@v${skill.version}` : ""}
                        </span>
                        {skill && (
                          <Link
                            to={`/skills/${encodeURIComponent(skill.name)}`}
                            className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta transition-colors hover:text-accent"
                          >
                            {t("playground.openInRegistry", "Open in registry →")}
                          </Link>
                        )}
                      </div>
                      <div className="min-h-0 flex-1">
                        {packageLoading ? (
                          <div className="p-4">
                            <Skeleton lines={8} />
                          </div>
                        ) : packageFiles.length > 0 ? (
                          <SkillPackagePreview
                            files={packageFiles}
                            fileContents={packageContents}
                            metadata={null}
                            editable={false}
                            className="h-full"
                          />
                        ) : (
                          <div className="flex h-32 items-center justify-center">
                            <p className="font-text text-xs text-meta">{t("playground.noPackage")}</p>
                          </div>
                        )}
                      </div>
                    </div>
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
