/**
 * Chat Input Component.
 * Auto-resizing textarea with Enter=send, Shift+Enter=newline.
 * Shows stop button during streaming. Model selection lives in the
 * page-level ModelPicker (top-right surface header).
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
        setValue(text);
        // Defer focus so the new value's height calculation lands first.
        requestAnimationFrame(() => textareaRef.current?.focus());
      },
      focus: () => textareaRef.current?.focus(),
    }),
    [],
  );

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="px-2 pb-2 pt-2">
      {/* Input row — model selection lives in the page header (ModelPicker). */}
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={
              customPlaceholder
                ?? (disabled
                  ? isStreaming
                    ? t("chatInput.generating")
                    : t("chatInput.awaitingTool")
                  : t("chatInput.placeholder"))
            }
            rows={1}
            className="neon-input w-full resize-none rounded px-4 py-3 pr-12 font-text text-sm text-strong placeholder:text-meta/50 disabled:opacity-50"
            style={{ maxHeight: `${MAX_HEIGHT_PX}px` }}
            aria-label="Chat message input"
          />
        </div>

        {isStreaming ? (
          <button
            type="button"
            onClick={onAbort}
            className="cta-letterpress cta-letterpress--ghost cursor-pointer rounded-sm border border-danger/50 bg-card px-4 py-3 font-text text-sm font-semibold text-danger hover:border-danger"
            aria-label={t("chatInput.stopGeneration")}
          >
            <StopIcon className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={`cta-letterpress cta-letterpress--ghost cursor-pointer rounded-sm border bg-card px-4 py-3 font-text text-sm font-semibold ${
              canSend
                ? "border-accent/50 text-accent hover:border-accent"
                : "border-meta/20 text-meta/40 cursor-not-allowed"
            }`}
            aria-label={t("chatInput.sendMessage")}
          >
            <SendIcon className="h-5 w-5" />
          </button>
        )}
      </div>
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
