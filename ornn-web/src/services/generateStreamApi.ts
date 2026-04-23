/**
 * Generate Stream API Service.
 * SSE client for the skill generation endpoint.
 * @module services/generateStreamApi
 */

import type { GenerationStreamEvent } from "@/types/streaming";
import { parseSseChunk } from "@/utils/sseParser";
import { useAuthStore } from "@/stores/authStore";
import { config } from "@/config";

const API_BASE = config.apiBaseUrl;

export interface GenerateStreamParams {
  messages: Array<{ role: string; content: string }>;
  model?: string;
}

export interface StreamHandle {
  abort: () => void;
}

function getAuthHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Connect to the generation SSE endpoint.
 * POST /api/v1/skills/generate
 */
export function generateSkillStream(
  params: GenerateStreamParams,
  onEvent: (event: GenerationStreamEvent) => void,
): StreamHandle {
  const controller = new AbortController();

  const url = new URL(
    `${API_BASE}/api/v1/skills/generate`,
    window.location.origin,
  );

  consumeStream(
    url.toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        messages: params.messages,
        model: params.model,
      }),
      signal: controller.signal,
    },
    onEvent,
  );

  return { abort: () => controller.abort() };
}

/** Valid event types emitted by the generation SSE endpoints. */
const GENERATION_EVENT_TYPES = new Set([
  "generation_start",
  "token",
  "generation_complete",
  "validation_error",
  "error",
]);

function isGenerationStreamEvent(
  event: unknown,
): event is GenerationStreamEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    typeof (event as Record<string, unknown>).type === "string" &&
    GENERATION_EVENT_TYPES.has((event as Record<string, unknown>).type as string)
  );
}

async function consumeStream(
  url: string,
  fetchOptions: RequestInit,
  onEvent: (event: GenerationStreamEvent) => void,
): Promise<void> {
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers: {
        Accept: "text/event-stream",
        ...fetchOptions.headers,
      },
    });

    if (!response.ok) {
      onEvent({
        type: "error",
        message: `HTTP ${response.status}: ${response.statusText}`,
      });
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
        if (isGenerationStreamEvent(event)) {
          onEvent(event);
        }
      }
    }

    if (buffer.trim()) {
      const { events } = parseSseChunk(buffer + "\n\n");
      for (const event of events) {
        if (isGenerationStreamEvent(event)) {
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
}
