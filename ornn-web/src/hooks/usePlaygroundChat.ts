/**
 * Hook managing the playground chat send -> stream -> display loop.
 *
 * Streaming model:
 *   - SSE events arrive from the backend at upstream-LLM rate (typically
 *     2-4 chars per token, ~20 ms between tokens).
 *   - Incoming text is appended to a `pendingTokensRef` buffer.
 *   - A pacer (`paceTimerRef`) drains the buffer one character at a time
 *     onto the displayed assistant message at a fixed cadence
 *     (`PACE_TICK_MS`). This is the "true" character-by-character
 *     typewriter — display speed decoupled from network speed.
 *   - When the LLM races ahead and the pending buffer grows large, the
 *     pacer takes >1 char per tick so the visible text catches up
 *     instead of typing out 30s after the response actually finished.
 *   - On `finish` / `tool-call` / `error` / `abort` we drain whatever's
 *     left immediately (paced typewriter is a UX nicety, not a contract).
 *
 * @module hooks/usePlaygroundChat
 */

import { useCallback, useRef, useEffect } from "react";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { streamChat, type StreamHandle } from "@/services/playgroundStreamApi";
import type { PlaygroundChatEvent, FileOutput } from "@/types/playground";
import { track } from "@/lib/analytics";

/**
 * Pacer tick interval. 22 ms ≈ 45 chars/sec when the buffer is small,
 * which reads as deliberate typewriter without feeling slow. Combined
 * with the catch-up logic below the perceived rate scales smoothly.
 */
const PACE_TICK_MS = 22;
/**
 * Backlog thresholds for adaptive draining. We aim to keep the visible
 * text within ~1 second of what's actually been received.
 *   - <  60 chars buffered:  1 char/tick → ~45 chars/sec (calm)
 *   - <  200 chars buffered: 3 chars/tick → ~135 chars/sec
 *   - >= 200 chars buffered: ceil(buffer / 60) chars/tick → catch up
 */
function charsPerTick(bufferLength: number): number {
  if (bufferLength < 60) return 1;
  if (bufferLength < 200) return 3;
  return Math.ceil(bufferLength / 60);
}

/** Trigger a browser file download from a base64-encoded FileOutput. */
function triggerFileDownload(file: FileOutput) {
  const byteString = atob(file.content);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.path.split("/").pop() ?? "download";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function usePlaygroundChat() {
  const store = usePlaygroundStore();
  const streamRef = useRef<StreamHandle | null>(null);

  // Pacer state — chars received from SSE that haven't been painted yet.
  const pendingTokensRef = useRef("");
  const paceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Pop one tick's worth of chars from the buffer and append. Spread
   *  via `Array.from` so a 4-byte emoji counts as one character (the
   *  buffer is a JS string; iterating by code units would split it). */
  const drainOneTick = useCallback(() => {
    const buf = pendingTokensRef.current;
    if (!buf) {
      // Buffer empty — pause the pacer until more text arrives.
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
    usePlaygroundStore.getState().appendAssistantDelta(head);
  }, []);

  const ensurePacer = useCallback(() => {
    if (paceTimerRef.current !== null) return;
    paceTimerRef.current = setInterval(drainOneTick, PACE_TICK_MS);
  }, [drainOneTick]);

  /** Drain everything to the display immediately. Used on terminal
   *  events (finish / error / abort / tool-call) so the typewriter
   *  doesn't keep ticking past the run. */
  const drainAll = useCallback(() => {
    if (paceTimerRef.current !== null) {
      clearInterval(paceTimerRef.current);
      paceTimerRef.current = null;
    }
    const buf = pendingTokensRef.current;
    if (buf) {
      pendingTokensRef.current = "";
      usePlaygroundStore.getState().appendAssistantDelta(buf);
    }
  }, []);

  const handleEvent = useCallback(
    (event: PlaygroundChatEvent) => {
      const s = usePlaygroundStore.getState();

      switch (event.type) {
        case "text-delta":
          // Stuff into the pacer buffer; the interval drains it.
          pendingTokensRef.current += event.delta;
          ensurePacer();
          break;

        case "tool-call":
          drainAll();
          s.finalizeAssistantMessage();
          s.addToolCall(event.toolCall);
          break;

        case "tool-result":
          drainAll();
          s.addToolResult(event.toolCallId, event.result);
          break;

        case "file-output":
          s.addFileOutput(event.file);
          triggerFileDownload(event.file);
          break;

        case "error":
          drainAll();
          s.setError(event.message);
          s.setStreaming(false);
          track("playground.run.failed", { error: event.message });
          break;

        case "finish":
          drainAll();
          s.finalizeAssistantMessage();
          s.setStreaming(false);
          track("playground.run.completed", {
            finishReason: event.finishReason,
          });
          break;
      }
    },
    [drainAll, ensurePacer],
  );

  const sendMessage = useCallback(
    (
      content: string,
      skillId?: string,
      envVars?: Record<string, string>,
      modelId?: string,
    ) => {
      streamRef.current?.abort();
      pendingTokensRef.current = "";
      if (paceTimerRef.current !== null) {
        clearInterval(paceTimerRef.current);
        paceTimerRef.current = null;
      }

      const s = usePlaygroundStore.getState();
      s.addUserMessage(content);
      s.setStreaming(true);
      s.setError(null);
      s.startAssistantMessage();

      track("playground.run", {
        skillId: skillId ?? null,
        promptLength: content.length,
        hasEnvVars: Boolean(envVars && Object.keys(envVars).length),
        modelId: modelId ?? null,
      });

      const msgs = usePlaygroundStore.getState().messages;
      const mapped = msgs.map((m) => ({ role: m.role, content: m.content }));
      const handle = streamChat({ messages: mapped, skillId, envVars, modelId }, handleEvent);
      streamRef.current = handle;
    },
    [handleEvent],
  );

  const abort = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    drainAll();
    const s = usePlaygroundStore.getState();
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
    usePlaygroundStore.getState().clearMessages();
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.abort();
      if (paceTimerRef.current !== null) clearInterval(paceTimerRef.current);
    };
  }, []);

  return {
    messages: store.messages,
    isStreaming: store.isStreaming,
    toolCallStatuses: store.toolCallStatuses,
    fileOutputs: store.fileOutputs,
    error: store.error,
    currentAssistantContent: store.currentAssistantContent,
    sendMessage,
    abort,
    clearChat,
  };
}
