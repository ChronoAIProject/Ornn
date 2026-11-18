import { createLogger } from "../../shared/logger";
import type { ResponsesApiStreamEvent } from "./llm";

const logger = createLogger("nyxLlmClient");

// ---------------------------------------------------------------------------
// SSE Parser (shared across both formats)
// ---------------------------------------------------------------------------

interface RawSseEvent {
  data: string;
}

async function* parseSSELines(response: Response): AsyncIterable<RawSseEvent> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (!data) continue;
          yield { data };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parse Responses-API SSE: each `data:` is a JSON event object. */
export async function* parseResponsesStream(
  response: Response,
): AsyncIterable<ResponsesApiStreamEvent> {
  for await (const { data } of parseSSELines(response)) {
    if (data === "[DONE]") return;
    try {
      yield JSON.parse(data) as ResponsesApiStreamEvent;
    } catch {
      logger.debug({ data: data.slice(0, 100) }, "Failed to parse SSE event");
    }
  }
}

/**
 * Internal accumulator for a single OpenAI Chat Completions tool call
 * as it streams in. `id` + `name` arrive on the first delta for that
 * tool-call index; `arguments` is a JSON string that accumulates
 * across many chunks before the model finishes emitting it.
 */
interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Parse Chat Completions SSE and translate it into Responses-API
 * event shape so downstream consumers (skill generation, playground
 * tool-use loop) stay format-agnostic.
 *
 * - `choices[].delta.content` chunks → `response.output_text.delta`
 *   events (#574).
 * - `choices[].delta.tool_calls` chunks are buffered per tool-call
 *   index (id + name + accumulated JSON arguments). When the turn
 *   completes (explicit `finish_reason` of `"tool_calls"` /
 *   `"stop"`, upstream `[DONE]`, or EOF), each buffered tool call is
 *   emitted as a synthesized `response.output_item.done` event with
 *   `item.type === "function_call"` — the exact shape the playground
 *   loop already consumes (#608). Without this the playground never
 *   sees a tool call from chat-completion providers and renders
 *   `execute_in_sandbox(...)` as plain text instead of running it.
 */
export async function* parseChatCompletionStream(
  response: Response,
): AsyncIterable<ResponsesApiStreamEvent> {
  const toolCalls = new Map<number, ToolCallAccumulator>();
  let flushed = false;

  function* flushToolCalls(): Generator<ResponsesApiStreamEvent> {
    if (flushed) return;
    flushed = true;
    const indices = [...toolCalls.keys()].sort((a, b) => a - b);
    for (const idx of indices) {
      const tc = toolCalls.get(idx)!;
      yield {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: tc.id,
          call_id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        },
      };
    }
  }

  for await (const { data } of parseSSELines(response)) {
    if (data === "[DONE]") {
      yield* flushToolCalls();
      return;
    }
    let chunk: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      logger.debug({ data: data.slice(0, 100) }, "Failed to parse chat-completion chunk");
      continue;
    }

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    const text = choice.delta?.content;
    if (typeof text === "string" && text.length > 0) {
      yield { type: "response.output_text.delta", delta: text };
    }

    const deltaToolCalls = choice.delta?.tool_calls;
    if (Array.isArray(deltaToolCalls)) {
      for (const piece of deltaToolCalls) {
        // OpenAI uses `index` to disambiguate parallel tool calls
        // within one assistant turn. Missing index → assume a single
        // tool call at index 0.
        const idx = typeof piece.index === "number" ? piece.index : 0;
        const acc = toolCalls.get(idx) ?? { id: "", name: "", arguments: "" };
        if (piece.id) acc.id = piece.id;
        if (piece.function?.name) acc.name = piece.function.name;
        if (typeof piece.function?.arguments === "string") {
          acc.arguments += piece.function.arguments;
        }
        toolCalls.set(idx, acc);
      }
    }

    // Some providers (DeepSeek, Together, …) terminate a tool-call
    // turn with finish_reason=tool_calls; others emit
    // finish_reason=stop alongside the final tool-call delta. Treat
    // any non-null finish_reason as "no more deltas this turn" and
    // flush so the playground loop sees the tool call before
    // [DONE] / EOF.
    if (choice.finish_reason && toolCalls.size > 0) {
      yield* flushToolCalls();
    }
  }

  // Stream ended without a [DONE] sentinel (some upstreams just
  // close the body). Flush any pending tool calls so we don't drop
  // them on the floor.
  yield* flushToolCalls();
}

