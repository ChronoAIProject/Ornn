/**
 * SSE streaming client for the Ornn Assistant chat endpoint (#970).
 *
 * POST /api/v1/assistant/chat — AUTH REQUIRED. Sends the conversation
 * history (+ optional model override) as a JSON body and consumes the
 * Server-Sent Events response. Mirrors `playgroundStreamApi` (canonical
 * auth header, AbortController cancel, shared `parseSseChunk`) but speaks
 * the assistant's own Zod-validated event contract.
 *
 * @module services/assistantStreamApi
 */

import { parseSseChunk } from "@/utils/sseParser";
import { useAuthStore } from "@/stores/authStore";
import {
  parseAssistantEvent,
  type AssistantChatEvent,
  type AssistantWireMessage,
} from "@/types/assistant";
import { config } from "@/config";
import { createLogger } from "@/lib/logger";

const logger = createLogger("assistantStreamApi");

const API_BASE = config.apiBaseUrl;

export interface AssistantStreamParams {
  messages: AssistantWireMessage[];
  // exactOptionalPropertyTypes (#657)
  modelId?: string | undefined;
}

export interface StreamHandle {
  abort: () => void;
}

/** Ensure a fresh token and retrieve the Bearer header from the auth store. */
async function getAuthHeaders(): Promise<Record<string, string>> {
  await useAuthStore.getState().ensureFreshToken();
  const token = useAuthStore.getState().accessToken;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Stream assistant replies from the SSE endpoint.
 *
 * Every parsed `data:` payload is validated against the assistant event
 * union; anything that fails (malformed / unknown / drifted) is skipped
 * with a debug log rather than forwarded as an untyped object.
 *
 * @param params  conversation history + optional model override
 * @param onEvent invoked once per validated SSE event, in arrival order
 * @returns a handle whose `abort()` cancels the in-flight request
 */
export function streamAssistantChat(
  params: AssistantStreamParams,
  onEvent: (event: AssistantChatEvent) => void,
): StreamHandle {
  const controller = new AbortController();
  const url = new URL(`${API_BASE}/api/v1/assistant/chat`, window.location.origin);

  (async () => {
    try {
      const authHeaders = await getAuthHeaders();
      logger.info("assistant chat stream opening", { messageCount: params.messages.length });

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...authHeaders,
        },
        body: JSON.stringify({
          messages: params.messages,
          modelId: params.modelId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let message = `HTTP ${response.status}: ${response.statusText}`;
        let code = `http_${response.status}`;
        try {
          const json = JSON.parse(text);
          // RFC 7807 problem+json (docs/CONVENTIONS.md) — prefer detail/title.
          if (typeof json.detail === "string") message = json.detail;
          else if (json.error?.message) message = json.error.message;
          if (typeof json.code === "string") code = json.code;
        } catch {
          /* use default message */
        }
        logger.error("assistant chat stream failed", { status: response.status, code });
        onEvent({ type: "chat_error", code, message });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onEvent({
          type: "chat_error",
          code: "stream_unsupported",
          message: "ReadableStream not supported",
        });
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

        for (const raw of events) {
          const event = parseAssistantEvent(raw);
          if (event) onEvent(event);
          else logger.debug("dropped unrecognized assistant event");
        }
      }

      // Flush any trailing buffered event.
      if (buffer.trim()) {
        const { events } = parseSseChunk(buffer + "\n\n");
        for (const raw of events) {
          const event = parseAssistantEvent(raw);
          if (event) onEvent(event);
        }
      }

      logger.info("assistant chat stream closed");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        logger.debug("assistant chat stream aborted");
        return;
      }
      logger.error("assistant chat stream error", { message: (err as Error).message });
      onEvent({
        type: "chat_error",
        code: "stream_failed",
        message: (err as Error).message ?? "Stream connection failed",
      });
    }
  })();

  return { abort: () => controller.abort() };
}
