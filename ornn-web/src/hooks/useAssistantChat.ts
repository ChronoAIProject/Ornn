/**
 * Hook driving the Ornn Assistant send → stream → display loop (#970).
 *
 * Streaming/typewriter model is identical to `usePlaygroundChat`:
 *   - SSE `chat_text_delta` events arrive at upstream-LLM rate and are
 *     pushed into a `pendingTokensRef` buffer.
 *   - A pacer drains that buffer one (or more) characters per tick onto
 *     the visible answer at a steady cadence — the typewriter effect is
 *     decoupled from network jitter. When the model races ahead, the
 *     pacer takes bigger bites so the visible text stays within ~1s of
 *     what's been received.
 *   - On any terminal event (`chat_finish` / `chat_error` / abort) we
 *     drain whatever's left immediately — the typewriter is a nicety,
 *     not a contract.
 *
 * Errors surface BOTH on the store (for inline display in the panel) and
 * as a toast, so a user who has scrolled away still sees the failure.
 *
 * @module hooks/useAssistantChat
 */

import { useCallback, useRef, useEffect } from "react";
import { useAssistantStore } from "@/stores/assistantStore";
import { streamAssistantChat, type StreamHandle } from "@/services/assistantStreamApi";
import { useToastStore } from "@/stores/toastStore";
import type { AssistantChatEvent } from "@/types/assistant";
import { createLogger } from "@/lib/logger";

const logger = createLogger("useAssistantChat");

/** Pacer tick interval. 22 ms ≈ 45 chars/sec when the buffer is small. */
const PACE_TICK_MS = 22;

/**
 * Adaptive drain rate — keep visible text within ~1s of what's received.
 *   - <  60 chars buffered:  1 char/tick  → calm typewriter
 *   - <  200 chars buffered: 3 chars/tick
 *   - >= 200 chars buffered: ceil(buffer / 60) chars/tick → catch up
 */
function charsPerTick(bufferLength: number): number {
  if (bufferLength < 60) return 1;
  if (bufferLength < 200) return 3;
  return Math.ceil(bufferLength / 60);
}

export function useAssistantChat() {
  const store = useAssistantStore();
  const addToast = useToastStore((s) => s.addToast);
  const streamRef = useRef<StreamHandle | null>(null);

  // Pacer state — chars received from SSE that haven't been painted yet.
  const pendingTokensRef = useRef("");
  const paceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Pop one tick's worth of chars from the buffer and append. Iterate
   *  via `Array.from` so a 4-byte emoji counts as one character. */
  const drainOneTick = useCallback(() => {
    const buf = pendingTokensRef.current;
    if (!buf) {
      if (paceTimerRef.current !== null) {
        clearInterval(paceTimerRef.current);
        paceTimerRef.current = null;
      }
      return;
    }
    const chars = Array.from(buf);
    const take = Math.min(charsPerTick(chars.length), chars.length);
    const head = chars.slice(0, take).join("");
    const tail = chars.slice(take).join("");
    pendingTokensRef.current = tail;
    useAssistantStore.getState().appendAssistantDelta(head);
  }, []);

  const ensurePacer = useCallback(() => {
    if (paceTimerRef.current !== null) return;
    paceTimerRef.current = setInterval(drainOneTick, PACE_TICK_MS);
  }, [drainOneTick]);

  /** Drain everything to the display immediately (terminal events). */
  const drainAll = useCallback(() => {
    if (paceTimerRef.current !== null) {
      clearInterval(paceTimerRef.current);
      paceTimerRef.current = null;
    }
    const buf = pendingTokensRef.current;
    if (buf) {
      pendingTokensRef.current = "";
      useAssistantStore.getState().appendAssistantDelta(buf);
    }
  }, []);

  const handleEvent = useCallback(
    (event: AssistantChatEvent) => {
      const s = useAssistantStore.getState();

      switch (event.type) {
        case "chat_start":
          logger.debug("assistant stream started", { model: event.model });
          break;

        case "chat_text_delta":
          pendingTokensRef.current += event.delta;
          ensurePacer();
          break;

        case "chat_error":
          drainAll();
          s.setError(event.message);
          s.setStreaming(false);
          logger.error("assistant stream error", { code: event.code });
          addToast({ type: "error", message: event.message });
          break;

        case "chat_finish":
          drainAll();
          s.finalizeAssistantMessage();
          s.setStreaming(false);
          logger.info("assistant stream finished");
          break;

        case "keepalive":
          // Heartbeat — nothing to do.
          break;
      }
    },
    [addToast, drainAll, ensurePacer],
  );

  const sendMessage = useCallback(
    (content: string, modelId?: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      streamRef.current?.abort();
      pendingTokensRef.current = "";
      if (paceTimerRef.current !== null) {
        clearInterval(paceTimerRef.current);
        paceTimerRef.current = null;
      }

      const s = useAssistantStore.getState();
      s.addUserMessage(trimmed);
      s.setStreaming(true);
      s.setError(null);
      s.startAssistantMessage();

      const msgs = useAssistantStore
        .getState()
        .messages.map((m) => ({ role: m.role, content: m.content }));
      streamRef.current = streamAssistantChat({ messages: msgs, modelId }, handleEvent);
    },
    [handleEvent],
  );

  const abort = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    drainAll();
    const s = useAssistantStore.getState();
    s.finalizeAssistantMessage();
    s.setStreaming(false);
  }, [drainAll]);

  const clearChat = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    if (paceTimerRef.current !== null) {
      clearInterval(paceTimerRef.current);
      paceTimerRef.current = null;
    }
    pendingTokensRef.current = "";
    useAssistantStore.getState().clearMessages();
  }, []);

  // Abort any in-flight stream + stop the pacer on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.abort();
      if (paceTimerRef.current !== null) clearInterval(paceTimerRef.current);
    };
  }, []);

  return {
    messages: store.messages,
    isStreaming: store.isStreaming,
    error: store.error,
    currentAssistantContent: store.currentAssistantContent,
    sendMessage,
    abort,
    clearChat,
  };
}
