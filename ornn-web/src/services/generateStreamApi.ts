/**
 * Generate Stream API Service.
 * SSE client for the skill generation endpoint.
 * @module services/generateStreamApi
 */

import type { GenerationStreamEvent } from "@/types/streaming";
import type { GenerationMode } from "@/types/skillPackage";
import { parseSseChunk } from "@/utils/sseParser";
import { useAuthStore } from "@/stores/authStore";
import { config } from "@/config";

const API_BASE = config.apiBaseUrl;

export interface GenerateStreamParams {
  messages: Array<{ role: string; content: string }>;
  // exactOptionalPropertyTypes (#657)
  modelId?: string | undefined;
  /** Package shape (#1242). Omitted → the server default (`advanced`). */
  mode?: GenerationMode | undefined;
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
        modelId: params.modelId,
        mode: params.mode,
      }),
      signal: controller.signal,
    },
    onEvent,
  );

  return { abort: () => controller.abort() };
}

/**
 * Build the error message for a request the server rejected before the
 * stream opened. Every pre-stream gate answers with RFC 7807
 * problem+json (docs/CONVENTIONS.md), so prefer its `detail` — that is
 * where e.g. `invalid_mode` explains the accepted values — and fall back
 * to the bare status line when the body is not parseable.
 */
async function describeHttpFailure(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}: ${response.statusText}`;
  const text = await response.text().catch(() => "");
  if (!text) return fallback;
  try {
    const json = JSON.parse(text) as { detail?: unknown; title?: unknown };
    if (typeof json.detail === "string" && json.detail) return json.detail;
    if (typeof json.title === "string" && json.title) return json.title;
  } catch {
    // Not JSON — a proxy error page or empty body; the status line is
    // the most honest thing we can show.
  }
  return fallback;
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
      onEvent({ type: "error", message: await describeHttpFailure(response) });
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
