/**
 * AssistantWidget — the Ornn Assistant launcher + slide-in chat panel (#970).
 *
 * A floating launcher (bottom-right) opens a corner chat panel that
 * streams repo-aware answers about Ornn. Reuses the Playground chat
 * primitives (`ChatMessage`, `ChatInput`) and the assistant data layer
 * (`useAssistantChat` + `useAssistantStore`).
 *
 * Forge Workshop language (docs/DESIGN.md):
 *   - semantic Tailwind tokens only (bg-page / bg-card / text-strong /
 *     text-accent / border-subtle …)
 *   - letterpress impression shadows via `cta-letterpress` /
 *     `card-impression` utilities — no soft drop shadows
 *   - press-DOWN hover on the launcher (never lift)
 *   - Framer Motion panel reveal at motion-medium cadence; respects
 *     prefers-reduced-motion (transforms collapse, content still appears)
 *
 * a11y: launcher + panel are keyboard operable, ESC and backdrop close,
 * focus moves into the composer on open and returns to the launcher on
 * close, every control carries a focus-visible ember ring + label.
 *
 * Mounted once in the authed app shell (RootLayout); renders nothing for
 * signed-out visitors.
 *
 * @module components/assistant/AssistantWidget
 */

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ChatMessage } from "@/components/playground/ChatMessage";
import { ChatInput, type ChatInputHandle } from "@/components/playground/ChatInput";
import { useAssistantChat } from "@/hooks/useAssistantChat";
import { useAssistantStore } from "@/stores/assistantStore";
import { useIsAuthenticated } from "@/stores/authStore";
import type { AssistantMessage } from "@/types/assistant";

/** Example questions shown in the empty state (i18n keys). */
const SUGGESTION_KEYS = [
  "assistant.suggestions.what",
  "assistant.suggestions.different",
  "assistant.suggestions.findSkill",
] as const;

export function AssistantWidget() {
  const isAuthenticated = useIsAuthenticated();
  const isOpen = useAssistantStore((s) => s.isOpen);
  const openPanel = useAssistantStore((s) => s.openPanel);
  const closePanel = useAssistantStore((s) => s.closePanel);

  // Authed-only surface — never mount for signed-out visitors.
  if (!isAuthenticated) return null;

  return createPortal(
    <>
      <AssistantLauncher isOpen={isOpen} onOpen={openPanel} />
      <AssistantPanel isOpen={isOpen} onClose={closePanel} />
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------

function AssistantLauncher({ isOpen, onOpen }: { isOpen: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {!isOpen && (
        <motion.button
          type="button"
          onClick={onOpen}
          aria-label={t("assistant.launch")}
          aria-haspopup="dialog"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 8 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 8 }}
          transition={{ type: "spring", stiffness: 320, damping: 26, mass: 0.7 }}
          className="cta-letterpress fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full border border-accent-muted bg-accent px-4 text-page sm:bottom-6 sm:right-6"
        >
          <SparkIcon className="h-5 w-5 shrink-0" />
          <span className="hidden font-mono text-[12px] font-semibold uppercase tracking-[0.12em] sm:inline">
            {t("assistant.launch")}
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function AssistantPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const {
    messages,
    isStreaming,
    currentAssistantContent,
    sendMessage,
    abort,
    clearChat,
  } = useAssistantChat();

  const inputRef = useRef<ChatInputHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Remember what had focus before opening so we can restore it on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

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

  return createPortal(
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
            initial={
              reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }
            }
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
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
              {hasConversation ? (
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
                </>
              ) : (
                <AssistantEmptyState onSuggestion={handleSuggestion} />
              )}
            </div>

            <div className="border-t border-subtle px-2">
              <ChatInput
                ref={inputRef}
                onSend={(content) => sendMessage(content)}
                onAbort={abort}
                disabled={isStreaming}
                isStreaming={isStreaming}
                placeholder={t("assistant.placeholder")}
              />
            </div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>,
    document.body,
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
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-warning-soft text-accent">
          <SparkIcon className="h-4 w-4" />
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
  return (
    <div className="flex h-full flex-col items-center justify-center py-6">
      <div className="w-full space-y-5 text-center">
        <div className="space-y-2">
          <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-accent/30 bg-warning-soft text-accent">
            <SparkIcon className="h-5 w-5" />
          </span>
          <h2 className="font-display text-xl font-semibold leading-tight tracking-tight text-strong">
            {t("assistant.empty.title")}
          </h2>
          <p className="mx-auto max-w-[18rem] font-text text-[13px] leading-relaxed text-body">
            {t("assistant.empty.subtitle")}
          </p>
        </div>

        <div className="space-y-2">
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
        </div>
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

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2z" />
      <path d="M18.5 14l.8 2.3 2.2.8-2.2.8-.8 2.3-.8-2.3-2.2-.8 2.2-.8.8-2.3z" opacity="0.7" />
    </svg>
  );
}

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
