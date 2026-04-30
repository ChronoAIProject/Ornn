/**
 * Chat Input Component.
 * Auto-resizing textarea with Enter=send, Shift+Enter=newline.
 * Shows stop button during streaming. Includes model selector dropdown.
 * @module components/playground/ChatInput
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { AVAILABLE_MODELS, type AvailableModelId } from "@/types/playground";

export interface ChatInputProps {
  onSend: (content: string) => void;
  onAbort: () => void;
  disabled: boolean;
  isStreaming: boolean;
  /** Custom placeholder text (overrides the default disabled/active placeholders). */
  placeholder?: string;
}

/** Maximum textarea height before scrolling. */
const MAX_HEIGHT_PX = 200;

export function ChatInput({
  onSend,
  onAbort,
  disabled,
  isStreaming,
  placeholder: customPlaceholder,
}: ChatInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedModel = usePlaygroundStore((s) => s.selectedModel);
  const setSelectedModel = usePlaygroundStore((s) => s.setSelectedModel);

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
      {/* Model selector */}
      <div className="mb-2 flex items-center gap-2">
        <label className="font-display text-[10px] uppercase tracking-wider text-meta">
          {t("chatInput.model")}
        </label>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value as AvailableModelId)}
          disabled={isStreaming}
          className="neon-input cursor-pointer appearance-none rounded-md px-2 py-1 font-mono text-xs text-strong disabled:opacity-50"
        >
          {AVAILABLE_MODELS.map((m) => (
            <option key={m.id} value={m.id} className="bg-page">
              {m.label} ({m.provider})
            </option>
          ))}
        </select>
      </div>

      {/* Input row */}
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
            className="neon-input w-full resize-none rounded-lg px-4 py-3 pr-12 font-text text-sm text-strong placeholder:text-meta/50 disabled:opacity-50"
            style={{ maxHeight: `${MAX_HEIGHT_PX}px` }}
            aria-label="Chat message input"
          />
        </div>

        {isStreaming ? (
          <motion.button
            type="button"
            onClick={onAbort}
            whileTap={{ scale: 0.97 }}
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.1, ease: "easeIn" }}
            className="glass cursor-pointer rounded-lg border border-danger/50 px-4 py-3 font-text text-sm font-semibold text-danger transition-all duration-200 hover:border-danger hover:shadow-[0_0_15px_rgba(255,0,60,0.3)]"
            aria-label={t("chatInput.stopGeneration")}
          >
            <StopIcon className="h-5 w-5" />
          </motion.button>
        ) : (
          <motion.button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            whileTap={canSend ? { scale: 0.97 } : undefined}
            whileHover={canSend ? { scale: 1.02 } : undefined}
            transition={{ duration: 0.1, ease: "easeIn" }}
            className={`glass cursor-pointer rounded-lg border px-4 py-3 font-text text-sm font-semibold transition-all duration-200 ${
              canSend
                ? "border-accent/50 text-accent hover:border-accent hover:shadow-[0_0_15px_rgba(255,107,0,0.3)]"
                : "border-text-muted/20 text-meta/40 cursor-not-allowed"
            }`}
            aria-label={t("chatInput.sendMessage")}
          >
            <SendIcon className="h-5 w-5" />
          </motion.button>
        )}
      </div>
    </div>
  );
}

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
