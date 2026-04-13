/**
 * Hook managing the playground chat send -> stream -> display loop.
 * Dispatches SSE events to the Zustand store with token batching.
 * @module hooks/usePlaygroundChat
 */

import { useCallback, useRef, useEffect } from "react";
import { usePlaygroundStore } from "@/stores/playgroundStore";
import { streamChat, type StreamHandle } from "@/services/playgroundStreamApi";
import type { PlaygroundChatEvent, FileOutput } from "@/types/playground";

/** Minimum interval (ms) between text-delta flushes to avoid re-render storms. */
const TOKEN_FLUSH_INTERVAL_MS = 50;

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
  const tokenBufferRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushTokenBuffer = useCallback(() => {
    flushTimerRef.current = null;
    const buffered = tokenBufferRef.current;
    if (!buffered) return;
    tokenBufferRef.current = "";
    usePlaygroundStore.getState().appendAssistantDelta(buffered);
  }, []);

  const cancelFlush = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const handleEvent = useCallback(
    (event: PlaygroundChatEvent) => {
      const s = usePlaygroundStore.getState();

      switch (event.type) {
        case "text-delta":
          // Batch token updates to reduce re-renders
          tokenBufferRef.current += event.delta;
          if (flushTimerRef.current === null) {
            flushTimerRef.current = setTimeout(
              flushTokenBuffer,
              TOKEN_FLUSH_INTERVAL_MS,
            );
          }
          break;

        case "tool-call":
          // Flush pending tokens before handling tool call
          cancelFlush();
          if (tokenBufferRef.current) {
            s.appendAssistantDelta(tokenBufferRef.current);
            tokenBufferRef.current = "";
          }
          s.finalizeAssistantMessage();
          s.addToolCall(event.toolCall);
          break;

        case "tool-result":
          cancelFlush();
          if (tokenBufferRef.current) {
            s.appendAssistantDelta(tokenBufferRef.current);
            tokenBufferRef.current = "";
          }
          s.addToolResult(event.toolCallId, event.result);
          break;

        case "file-output":
          s.addFileOutput(event.file);
          triggerFileDownload(event.file);
          break;

        case "error":
          cancelFlush();
          if (tokenBufferRef.current) {
            s.appendAssistantDelta(tokenBufferRef.current);
            tokenBufferRef.current = "";
          }
          s.setError(event.message);
          s.setStreaming(false);
          break;

        case "finish":
          cancelFlush();
          if (tokenBufferRef.current) {
            s.appendAssistantDelta(tokenBufferRef.current);
            tokenBufferRef.current = "";
          }
          s.finalizeAssistantMessage();
          s.setStreaming(false);
          break;
      }
    },
    [flushTokenBuffer, cancelFlush],
  );

  const sendMessage = useCallback(
    (content: string, skillId?: string, envVars?: Record<string, string>) => {
      streamRef.current?.abort();
      tokenBufferRef.current = "";
      cancelFlush();

      const s = usePlaygroundStore.getState();
      s.addUserMessage(content);
      s.setStreaming(true);
      s.setError(null);
      s.startAssistantMessage();

      const msgs = usePlaygroundStore.getState().messages;
      const mapped = msgs.map((m) => ({ role: m.role, content: m.content }));
      const handle = streamChat({ messages: mapped, skillId, envVars }, handleEvent);
      streamRef.current = handle;
    },
    [handleEvent, cancelFlush],
  );

  const abort = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    cancelFlush();

    // Flush remaining buffered tokens
    if (tokenBufferRef.current) {
      usePlaygroundStore
        .getState()
        .appendAssistantDelta(tokenBufferRef.current);
      tokenBufferRef.current = "";
    }

    const s = usePlaygroundStore.getState();
    s.finalizeAssistantMessage();
    s.setStreaming(false);
  }, [cancelFlush]);

  const clearChat = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    cancelFlush();
    tokenBufferRef.current = "";
    usePlaygroundStore.getState().clearMessages();
  }, [cancelFlush]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.abort();
      cancelFlush();
    };
  }, [cancelFlush]);

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
