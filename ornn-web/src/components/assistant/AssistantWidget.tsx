/**
 * AssistantWidget — the Ornn Assistant mascot launcher + slide-in chat
 * panel (#970, redesigned #976).
 *
 * A draggable Ornn-mascot launcher floats over every page (anonymous +
 * authenticated) and opens a corner chat panel that streams repo-aware
 * answers. Reuses the Playground chat primitives (`ChatMessage`,
 * `ChatInput`) and the assistant data layer (`useAssistantChat` +
 * `useAssistantStore`).
 *
 * Behavior (#976):
 *   - Anonymous visitors see the launcher + panel, but a send attempt is
 *     intercepted with an inline sign-in prompt instead of hitting the
 *     authed-only backend. Authenticated send is unchanged.
 *   - The launcher is the Ornn mascot — draggable anywhere in the
 *     viewport, position persisted to localStorage, click-vs-drag
 *     disambiguated so a drag never opens the panel.
 *   - On a visitor's FIRST ever load the panel auto-expands once
 *     (localStorage-gated); later visits start collapsed.
 *
 * Forge Workshop language (docs/DESIGN.md):
 *   - semantic Tailwind tokens only (bg-page / bg-card / text-strong /
 *     text-accent / border-subtle …)
 *   - letterpress impression shadows via `cta-letterpress` /
 *     `card-impression` utilities — no soft drop shadows on cards/CTAs
 *   - press-DOWN feedback (never lift)
 *   - Framer Motion reveals respect prefers-reduced-motion — transforms
 *     collapse, content still fully appears.
 *
 * a11y: launcher + panel are keyboard operable, ESC and backdrop close,
 * focus moves into the composer on open and returns to the launcher on
 * close, every control carries a focus-visible ember ring + label. Drag
 * is a pointer-only enhancement; keyboard users just activate to open.
 *
 * Mounted once globally (App.tsx → AnalyticsRoot) via a portal.
 *
 * @module components/assistant/AssistantWidget
 */

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion, useMotionValue } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ChatMessage } from "@/components/playground/ChatMessage";
import { ChatInput, type ChatInputHandle } from "@/components/playground/ChatInput";
import { useAssistantChat } from "@/hooks/useAssistantChat";
import { useAssistantStore } from "@/stores/assistantStore";
import { useIsAuthenticated, useAuthStore } from "@/stores/authStore";
import { createLogger } from "@/lib/logger";
import type { AssistantMessage } from "@/types/assistant";
import mascotUrl from "@/assets/ornn-mascot.webp";

const logger = createLogger("AssistantWidget");

/** Example questions shown in the empty state (i18n keys). */
const SUGGESTION_KEYS = [
  "assistant.suggestions.what",
  "assistant.suggestions.different",
  "assistant.suggestions.findSkill",
] as const;

/** localStorage key — set once we auto-open the panel on first visit. */
const AUTO_OPENED_KEY = "ornn:assistant:auto-opened";
/** localStorage key — persisted launcher resting position `{x, y}`. */
const POS_KEY = "ornn:assistant:launcher-pos";
/** Delay before the first-visit auto-open, for a smooth reveal. */
const AUTO_OPEN_DELAY_MS = 700;

/** Draggable launcher box, matching the mascot's 502×640 aspect. */
const LAUNCHER_W = 88;
const LAUNCHER_H = 112;
/** Keep the launcher at least this far from any viewport edge. */
const EDGE_MARGIN = 20;

type Point = { x: number; y: number };

/** Clamp a launcher position so the whole box stays inside the viewport. */
function clampLauncherPos(pos: Point, w = LAUNCHER_W, h = LAUNCHER_H): Point {
  if (typeof window === "undefined") return pos;
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);
  return {
    x: Math.min(Math.max(EDGE_MARGIN, pos.x), maxX),
    y: Math.min(Math.max(EDGE_MARGIN, pos.y), maxY),
  };
}

/** Default resting position — bottom-right corner. */
function defaultLauncherPos(): Point {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return clampLauncherPos({
    x: window.innerWidth - LAUNCHER_W - EDGE_MARGIN,
    y: window.innerHeight - LAUNCHER_H - EDGE_MARGIN,
  });
}

/** Restore the persisted position (clamped into the current viewport). */
function loadLauncherPos(): Point {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Point>;
      if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
        return clampLauncherPos({ x: parsed.x, y: parsed.y });
      }
    }
  } catch {
    // localStorage unavailable / malformed — fall through to default.
  }
  return defaultLauncherPos();
}

export function AssistantWidget() {
  const isOpen = useAssistantStore((s) => s.isOpen);
  const openPanel = useAssistantStore((s) => s.openPanel);
  const closePanel = useAssistantStore((s) => s.closePanel);

  // First-visit auto-open. Runs once on first ever load: opens the panel
  // after a short delay, then sets the flag so later visits/reloads start
  // collapsed. Reads the action via getState() so this effect has no deps
  // and never re-schedules.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!localStorage.getItem(AUTO_OPENED_KEY)) {
        localStorage.setItem(AUTO_OPENED_KEY, "1");
        logger.debug("first-visit detected — scheduling assistant auto-open");
        timer = setTimeout(() => {
          useAssistantStore.getState().openPanel();
        }, AUTO_OPEN_DELAY_MS);
      }
    } catch {
      // localStorage unavailable (private mode / SSR) — skip auto-open.
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  return createPortal(
    <>
      <AssistantLauncher isOpen={isOpen} onOpen={openPanel} />
      <AssistantPanel isOpen={isOpen} onClose={closePanel} />
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Launcher — draggable Ornn mascot
// ---------------------------------------------------------------------------

function AssistantLauncher({ isOpen, onOpen }: { isOpen: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  // Full-screen, click-through constraints box — bounds the drag to the
  // viewport (Framer keeps the element inside this ref's rect).
  const constraintsRef = useRef<HTMLDivElement>(null);
  // Position lives in motion values so dragging never re-renders React.
  // Computed once via lazy init from the persisted/clamped position.
  const [initialPos] = useState(loadLauncherPos);
  const x = useMotionValue(initialPos.x);
  const y = useMotionValue(initialPos.y);
  // Set while a real drag is in progress so the trailing click doesn't open.
  const draggedRef = useRef(false);
  const [showBubble, setShowBubble] = useState(false);

  const persistPos = useCallback(() => {
    try {
      const clamped = clampLauncherPos({ x: x.get(), y: y.get() });
      x.set(clamped.x);
      y.set(clamped.y);
      localStorage.setItem(POS_KEY, JSON.stringify(clamped));
      logger.debug("assistant launcher position persisted", clamped);
    } catch {
      // Non-fatal — position just won't survive reload.
    }
  }, [x, y]);

  // Re-clamp into the viewport on resize so the launcher can't end up
  // stranded off-screen after a window/orientation change.
  useEffect(() => {
    const onResize = () => {
      const clamped = clampLauncherPos({ x: x.get(), y: y.get() });
      x.set(clamped.x);
      y.set(clamped.y);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [x, y]);

  return (
    <motion.div
      ref={constraintsRef}
      aria-hidden={isOpen}
      className="pointer-events-none fixed inset-0 z-40"
    >
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            type="button"
            aria-label={t("assistant.launch")}
            aria-haspopup="dialog"
            drag
            dragConstraints={constraintsRef}
            dragMomentum={false}
            dragElastic={0}
            onDragStart={() => {
              draggedRef.current = true;
            }}
            onDragEnd={() => {
              persistPos();
              // Clear AFTER the synthetic click that follows pointerup, so
              // a drag-release never falls through to onOpen.
              setTimeout(() => {
                draggedRef.current = false;
              }, 0);
            }}
            onClick={() => {
              if (draggedRef.current) return;
              onOpen();
            }}
            onMouseEnter={() => setShowBubble(true)}
            onMouseLeave={() => setShowBubble(false)}
            onFocus={() => setShowBubble(true)}
            onBlur={() => setShowBubble(false)}
            {...(reduceMotion ? {} : { whileTap: { scale: 0.93 } })}
            whileDrag={{ cursor: "grabbing" }}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 320, damping: 24, mass: 0.7 }}
            style={{ x, y, width: LAUNCHER_W, height: LAUNCHER_H }}
            className="group pointer-events-auto absolute left-0 top-0 flex cursor-grab touch-none items-end justify-center rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page"
          >
            {/* Quiet ember aura behind the mascot — ember-only, static at
                rest, and only intensifying on hover/focus/active so the
                glow signals interaction rather than baseline bloom. No
                perpetual pulse, no arc-blue wash (docs/DESIGN.md). */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-2 bottom-1 top-3 -z-10 rounded-full opacity-25 blur-lg motion-safe:transition-opacity motion-safe:duration-200 group-hover:opacity-60 group-focus-visible:opacity-60 group-active:opacity-75"
              style={{
                background:
                  "radial-gradient(circle at 50% 60%, var(--color-ember-glow), transparent 70%)",
              }}
            />
            {/* Idle bob — gentle vertical float; static under reduced motion. */}
            <motion.span
              className="relative flex h-full w-full items-end justify-center"
              {...(reduceMotion
                ? {}
                : {
                    animate: { y: [0, -7, 0] },
                    transition: { duration: 3.4, repeat: Infinity, ease: "easeInOut" as const },
                  })}
            >
              <img
                src={mascotUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="h-full w-full select-none object-contain"
              />
            </motion.span>

            {/* "Ask Ornn" speech bubble — hover/focus hint (desktop). */}
            <span className="pointer-events-none absolute right-full top-2 mr-1 hidden sm:block">
              <AnimatePresence>
                {showBubble && !isOpen && (
                  <motion.span
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 6, scale: 0.96 }}
                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 6, scale: 0.96 }}
                    transition={{ duration: 0.16 }}
                    className="card-impression block whitespace-nowrap rounded border border-subtle bg-card px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-strong"
                  >
                    {t("assistant.launch")}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function AssistantPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const isAuthenticated = useIsAuthenticated();
  const loginWithNyxID = useAuthStore((s) => s.loginWithNyxID);
  const {
    messages,
    isStreaming,
    error,
    currentAssistantContent,
    sendMessage,
    abort,
    clearChat,
    retry,
  } = useAssistantChat();

  const inputRef = useRef<ChatInputHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Remember what had focus before opening so we can restore it on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Anonymous send → inline sign-in prompt instead of hitting the backend.
  const [signInPrompt, setSignInPrompt] = useState(false);
  // Reset the sign-in prompt the moment the panel closes, so a reopen
  // starts from the clean empty state. Done as a render-time adjustment
  // (React's blessed pattern) rather than an effect — no extra commit.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen && signInPrompt) setSignInPrompt(false);
  }

  // ESC closes; capture the previously-focused element on open.
  useEffect(() => {
    if (!isOpen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Return focus to the launcher (or whatever opened the panel).
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  // Focus the composer once the panel is open.
  useEffect(() => {
    if (isOpen) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [isOpen]);

  // Keep the transcript pinned to the latest turn / streamed token.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, currentAssistantContent, isStreaming]);

  const hasConversation = messages.length > 0 || currentAssistantContent.length > 0;
  // A streaming turn before its first token → show the thinking indicator.
  const showThinking = isStreaming && currentAssistantContent.length === 0;

  const handleSuggestion = (text: string) => {
    inputRef.current?.setValue(text);
  };

  // Intercept send for signed-out visitors: surface the sign-in prompt and
  // never call the authed-only chat backend. Authenticated send unchanged.
  const handleSend = useCallback(
    (content: string) => {
      if (!isAuthenticated) {
        logger.info("assistant send intercepted — visitor signed out, prompting sign-in");
        setSignInPrompt(true);
        return;
      }
      sendMessage(content);
    },
    [isAuthenticated, sendMessage],
  );

  // Focus trap — keep Tab / Shift+Tab cycling inside the dialog so focus
  // can't escape to the backdrop'd page behind it. Paired with the
  // focus-in-on-open / restore-on-close effects above. Scoped to the
  // panel via currentTarget so no ref threading is needed.
  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab") return;
    const focusables = e.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !e.currentTarget.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop — light scrim, click closes. Keeps the page faintly
              visible (corner widget, not a full modal takeover). */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={t("assistant.title")}
            onKeyDown={handlePanelKeyDown}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 260, damping: 26, mass: 0.8 }}
            className="card-impression absolute bottom-0 right-0 flex h-[100dvh] w-full flex-col overflow-hidden border border-subtle bg-page sm:bottom-6 sm:right-6 sm:h-[min(620px,calc(100dvh-7rem))] sm:w-[400px] sm:rounded"
          >
            <PanelHeader
              onClose={onClose}
              onClear={clearChat}
              canClear={hasConversation}
            />

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
            >
              {signInPrompt ? (
                <AssistantSignInPrompt
                  onSignIn={loginWithNyxID}
                  onDismiss={() => setSignInPrompt(false)}
                />
              ) : hasConversation || error ? (
                <>
                  {messages.map((m: AssistantMessage) => (
                    <ChatMessage key={m.id} message={m} toolCallStatuses={{}} />
                  ))}
                  {currentAssistantContent.length > 0 && (
                    <ChatMessage
                      message={{
                        id: "assistant-streaming",
                        role: "assistant",
                        content: currentAssistantContent,
                      }}
                      toolCallStatuses={{}}
                      isStreaming={isStreaming}
                    />
                  )}
                  {showThinking && <ThinkingIndicator label={t("assistant.thinking")} />}
                  {/* Inline error — the source of truth (the global toast
                      container isn't mounted on the landing page, where the
                      widget now also lives). */}
                  {error && !isStreaming && (
                    <AssistantErrorState message={error} onRetry={retry} />
                  )}
                </>
              ) : (
                <AssistantEmptyState onSuggestion={handleSuggestion} />
              )}
            </div>

            <div className="border-t border-subtle px-2">
              <ChatInput
                ref={inputRef}
                onSend={handleSend}
                onAbort={abort}
                disabled={isStreaming}
                isStreaming={isStreaming}
                placeholder={t("assistant.placeholder")}
              />
            </div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}

function PanelHeader({
  onClose,
  onClear,
  canClear,
}: {
  onClose: () => void;
  onClear: () => void;
  canClear: boolean;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between gap-3 border-b border-subtle bg-card px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-accent/30 bg-warning-soft">
          <img
            src={mascotUrl}
            alt=""
            aria-hidden="true"
            className="h-8 w-8 object-contain object-top"
          />
        </span>
        <div className="leading-tight">
          <p className="font-display text-sm font-semibold tracking-tight text-strong">
            {t("assistant.title")}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
            {t("assistant.subtitle")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {canClear && (
          <IconButton label={t("assistant.clear")} onClick={onClear}>
            <TrashIcon className="h-4 w-4" />
          </IconButton>
        )}
        <IconButton label={t("assistant.close")} onClick={onClose}>
          <CloseIcon className="h-4 w-4" />
        </IconButton>
      </div>
    </header>
  );
}

function AssistantEmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  // Conditionally-applied motion props — omitted entirely under reduced
  // motion so content appears statically (and to satisfy
  // exactOptionalPropertyTypes, which forbids passing `undefined`).
  const groupProps = reduceMotion
    ? {}
    : {
        variants: { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } } },
        initial: "hidden" as const,
        animate: "show" as const,
      };
  const itemProps = reduceMotion
    ? {}
    : { variants: { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } } };
  const waveProps = reduceMotion
    ? {}
    : {
        animate: { rotate: [0, -7, 6, -7, 0] },
        transition: { duration: 2.6, repeat: Infinity, repeatDelay: 1.6, ease: "easeInOut" as const },
      };

  return (
    <div className="flex h-full flex-col items-center justify-center py-6">
      <motion.div className="w-full space-y-5 text-center" {...groupProps}>
        <motion.div className="space-y-2" {...itemProps}>
          {/* Mascot waves hello in place of the old abstract spark. */}
          <motion.div
            className="mx-auto h-24 w-[76px]"
            style={{ transformOrigin: "bottom center" }}
            {...waveProps}
          >
            <img
              src={mascotUrl}
              alt={t("assistant.mascotAlt")}
              draggable={false}
              className="h-full w-full select-none object-contain"
            />
          </motion.div>
          <h2 className="font-display text-xl font-semibold leading-tight tracking-tight text-strong">
            {t("assistant.greeting")}
          </h2>
          <p className="mx-auto max-w-[18rem] font-text text-[13px] leading-relaxed text-body">
            {t("assistant.empty.subtitle")}
          </p>
        </motion.div>

        <motion.div className="space-y-2" {...itemProps}>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-meta/80">
            {t("assistant.empty.hint")}
          </p>
          <div className="space-y-2">
            {SUGGESTION_KEYS.map((key) => {
              const label = t(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSuggestion(label)}
                  className="focus-ring-ember group flex w-full items-center gap-2 rounded border border-subtle bg-card px-3 py-2.5 text-left transition-colors hover:border-accent/60"
                >
                  <ArrowIcon className="h-3.5 w-3.5 shrink-0 text-accent/70 transition-colors group-hover:text-accent" />
                  <span className="font-text text-[13px] leading-snug text-body group-hover:text-strong">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

function AssistantSignInPrompt({
  onSignIn,
  onDismiss,
}: {
  onSignIn: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex h-full flex-col items-center justify-center py-6">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 280, damping: 26 }}
        className="card-impression w-full max-w-[20rem] space-y-4 rounded border border-subtle bg-card px-5 py-6 text-center"
      >
        <span className="mx-auto block h-16 w-[50px]">
          <img
            src={mascotUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-full w-full select-none object-contain"
          />
        </span>
        <div className="space-y-1.5">
          <h2 className="font-display text-base font-semibold tracking-tight text-strong">
            {t("assistant.signIn.title")}
          </h2>
          <p className="font-text text-[13px] leading-relaxed text-body">
            {t("assistant.signIn.body")}
          </p>
        </div>
        <div className="space-y-2">
          <button
            type="button"
            onClick={onSignIn}
            className="cta-letterpress inline-flex h-11 w-full items-center justify-center rounded-sm border border-accent-muted bg-accent font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-page"
          >
            {t("assistant.signIn.cta")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="focus-ring-ember inline-flex h-9 w-full items-center justify-center rounded-sm font-mono text-[11px] uppercase tracking-[0.12em] text-meta transition-colors hover:text-strong"
          >
            {t("assistant.signIn.dismiss")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function AssistantErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    // role="alert" announces the failure to assistive tech without needing
    // focus. No motion — readable + announced regardless of motion prefs.
    <div role="alert" className="flex justify-start">
      <div className="w-full space-y-2 rounded border border-danger/40 bg-danger/10 px-3 py-2.5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-danger/80">
          {t("assistant.errorTitle")}
        </p>
        <p className="font-text text-[13px] leading-relaxed text-danger">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring-ember inline-flex items-center gap-1.5 rounded-sm font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-danger transition-colors hover:text-strong"
        >
          <RetryIcon className="h-3.5 w-3.5" />
          {t("assistant.retry")}
        </button>
      </div>
    </div>
  );
}

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex justify-start" role="status" aria-label={label}>
      <div className="inline-flex items-center gap-1.5 rounded-2xl border border-subtle bg-card px-4 py-3">
        <Dot delay="0ms" />
        <Dot delay="160ms" />
        <Dot delay="320ms" />
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  // motion-safe pulse; reduced-motion users get a static dot (still legible).
  return (
    <span
      className="h-1.5 w-1.5 rounded-full bg-accent/70 motion-safe:animate-pulse"
      style={{ animationDelay: delay }}
    />
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      // h-11 w-11 = 44px min touch target (docs/DESIGN.md a11y guideline).
      className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-meta transition-colors hover:bg-elevated hover:text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline — no external icon dependency)
// ---------------------------------------------------------------------------

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H6a1 1 0 01-1-1V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function RetryIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 11-3.5-7.1" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}
