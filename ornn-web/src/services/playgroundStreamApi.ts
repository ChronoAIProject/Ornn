/**
 * SSE streaming client for the playground chat endpoint.
 * POST /api/playground/chat with Responses API format body, receives SSE response.
 * @module services/playgroundStreamApi
 */

import { parseSseChunk } from "@/utils/sseParser";
import { useAuthStore } from "@/stores/authStore";
import { PLAYGROUND_EVENT_TYPES, type PlaygroundChatEvent } from "@/types/playground";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface ChatStreamParams {
  messages: Array<{ role: string; content: string }>;
  skillId?: string;
  envVars?: Record<string, string>;
}

export interface StreamHandle {
  abort: () => void;
}

/** Ensure fresh token and retrieve Bearer header from auth store. */
async function getAuthHeaders(): Promise<Record<string, string>> {
  await useAuthStore.getState().ensureFreshToken();
  const token = useAuthStore.getState().accessToken;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/** Type guard for PlaygroundChatEvent. */
function isPlaygroundEvent(event: unknown): event is PlaygroundChatEvent {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Record<string, unknown>;
  return (
    typeof e.type === "string" &&
    PLAYGROUND_EVENT_TYPES.has(e.type as string)
  );
}

/**
 * Stream chat messages from the playground SSE endpoint.
 * Uses POST with JSON body (Responses API format).
 */
export function streamChat(
  params: ChatStreamParams,
  onEvent: (event: PlaygroundChatEvent) => void,
): StreamHandle {
  const controller = new AbortController();
  const url = new URL(`${API_BASE}/api/playground/chat`, window.location.origin);

  (async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...authHeaders,
        },
        body: JSON.stringify({
          messages: params.messages,
          skillId: params.skillId,
          envVars: params.envVars,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let message = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const json = JSON.parse(text);
          if (json.error?.message) message = json.error.message;
        } catch {
          /* use default message */
        }
        onEvent({ type: "error", message });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onEvent({ type: "error", message: "ReadableStream not supported" });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSseChunk(buffer);
        buffer = remainder;

        for (const event of events) {
          if (isPlaygroundEvent(event)) {
            onEvent(event);
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const { events } = parseSseChunk(buffer + "\n\n");
        for (const event of events) {
          if (isPlaygroundEvent(event)) {
            onEvent(event);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      onEvent({
        type: "error",
        message: (err as Error).message ?? "Stream connection failed",
      });
    }
  })();

  return { abort: () => controller.abort() };
}
