/**
 * Chat Input Component.
 * Auto-resizing textarea with Enter=send, Shift+Enter=newline.
 * Shows stop button during streaming. Model selection lives in the
 * page-level ModelPicker (top-right surface header).
 *
 * #654 — adds a length cap + visible counter. Previously the textarea
 * accepted unbounded content (24k chars was the live reproducer) and
 * the send button stayed enabled regardless of length, so users could
 * fire requests the backend would reject (or worse, accept + crash on
 * downstream LLM token-limit). Now:
 *
 *   - `maxLength` on the textarea hard-caps at MAX_INPUT_CHARS — the
 *     browser refuses typing/paste beyond that, no extra JS needed.
 *   - A counter appears once the input crosses WARN_AT_CHARS so users
 *     get warning room rather than a surprise wall.
 *   - Counter goes danger-tone + send disables once the trimmed
 *     content is over the limit (defensive — `maxLength` should make
 *     this unreachable, but the explicit guard catches any IME / paste
 *     edge case that slips past).
 *
 * The backend (`domains/playground/routes.ts` + `skills/generation/
 * routes.ts`) caps content at the same 32 000-char ceiling — frontend
 * is UX, backend is the hard line.
 *
 * @module components/playground/ChatInput
 */

import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";

export interface ChatInputProps {
  onSend: (content: string) => void;
  onAbort: () => void;
  disabled: boolean;
  isStreaming: boolean;
  /** Custom placeholder text (overrides the default disabled/active placeholders). */
  placeholder?: string;
}

export interface ChatInputHandle {
  /** Replace the current textarea value (used by suggestion-prompt clicks). */
  setValue: (text: string) => void;
  /** Move focus into the textarea. */
  focus: () => void;
}

/** Maximum textarea height before scrolling. */
const MAX_HEIGHT_PX = 200;

/**
 * Maximum input length. ~8k tokens at 4 chars/token — generous for
 * interactive prompts without enabling whole-novel pastes. Mirrors the
 * `.max()` cap on `playgroundMessageSchema.content` /
 * `skills/generation` route bodies; if you change one, change both.
 */
const MAX_INPUT_CHARS = 32_000;

/** Threshold above which the live counter becomes visible (~75%). */
const WARN_AT_CHARS = 24_000;

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  onSend,
  onAbort,
  disabled,
  isStreaming,
  placeholder: customPlaceholder,
}, ref) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Resize textarea to fit content. */
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useImperativeHandle(
    ref,
    () => ({
      setValue: (text: string) => {
        // Truncate suggestion-prompt clicks defensively — the suggestion
        // catalogue is curated short copy today, but a future longer
        // prompt shouldn't bypass the cap silently.
        setValue(text.slice(0, MAX_INPUT_CHARS));
        // Defer focus so the new value's height calculation lands first.
        requestAnimationFrame(() => textareaRef.current?.focus());
      },
      focus: () => textareaRef.current?.focus(),
    }),
    [],
  );

  const trimmedLength = value.trim().length;
  const isOverLimit = trimmedLength > MAX_INPUT_CHARS;
  const shouldShowCounter = value.length >= WARN_AT_CHARS;

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled || trimmed.length > MAX_INPUT_CHARS) return;
    onSend(trimmed);
    setValue("");
  }, [value, disabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const canSend = trimmedLength > 0 && !disabled && !isOverLimit;

  return (
    <div className="px-1 pb-2 pt-2">
      {/* ChatGPT-style composer — single rounded surface, send button
          docked inside on the right. Ember focus ring marks the active
          state without competing with the conversation above. */}
      <div
        className={`relative flex items-end gap-2 rounded-2xl border bg-card px-3 py-2 transition-colors ${
          disabled
            ? "border-subtle/60"
            : isOverLimit
              ? "border-danger/60 focus-within:border-danger/80 focus-within:ring-1 focus-within:ring-danger/30"
              : "border-subtle focus-within:border-accent/60 focus-within:ring-1 focus-within:ring-accent/30"
        }`}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          maxLength={MAX_INPUT_CHARS}
          placeholder={
            customPlaceholder
              ?? (disabled
                ? isStreaming
                  ? t("chatInput.generating")
                  : t("chatInput.awaitingTool")
                : t("chatInput.placeholder"))
          }
          rows={1}
          className="flex-1 resize-none bg-transparent px-1.5 py-1.5 font-text text-[15px] leading-6 text-strong placeholder:text-meta/60 focus:outline-none disabled:opacity-50"
          style={{ maxHeight: `${MAX_HEIGHT_PX}px` }}
          aria-label={t("aria.chatMessageInput")}
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={onAbort}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-danger/50 bg-card text-danger transition-colors hover:border-danger"
            aria-label={t("chatInput.stopGeneration")}
          >
            <StopIcon className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
              canSend
                ? "bg-accent text-page hover:bg-accent/90"
                : "cursor-not-allowed bg-elevated text-meta/40"
            }`}
            aria-label={t("chatInput.sendMessage")}
          >
            <SendIcon className="h-5 w-5" />
          </button>
        )}
      </div>
      {/* Counter row — appears only past WARN_AT_CHARS so it doesn't
          chrome the composer for normal use. Goes danger-tone past the
          cap. */}
      {shouldShowCounter && (
        <p
          className={`mt-1 text-right text-[11px] tabular-nums ${
            isOverLimit ? "text-danger" : "text-meta/70"
          }`}
          aria-live="polite"
        >
          {isOverLimit
            ? t("chatInput.overLimit", { max: MAX_INPUT_CHARS })
            : t("chatInput.charCount", { count: value.length, max: MAX_INPUT_CHARS })}
        </p>
      )}
    </div>
  );
});

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 19V5m0 0l-7 7m7-7l7 7"
      />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
