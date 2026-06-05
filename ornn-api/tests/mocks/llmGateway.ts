/**
 * LLM gateway mock — drop-in replacement for `NyxLlmClient` in
 * integration tests. Surfaces the same `stream()` + `complete()`
 * methods the real client exposes; tests drive it via
 * `installLlmGatewayMock()` to control outcome (success / skill_error /
 * system_error) and the resolved model id reported through the stream.
 *
 * Avoids spinning up a real HTTP listener — the Bun `Response` body
 * pump in `NyxLlmClient` was the only thing exercising network IO and
 * we don't need it for quota-charge / per-model accounting tests.
 *
 * @module tests/mocks/llmGateway
 */

import type {
  NyxLlmStreamParams,
  NyxLlmCompleteParams,
  ResponsesApiOutput,
  ResponsesApiStreamEvent,
} from "../../src/clients/nyxid/llm";

export type LlmGatewayOutcome = "success" | "skill_error" | "system_error";

export interface LlmGatewayMockOptions {
  /** Final outcome of the stream — drives which events get yielded. */
  outcome?: LlmGatewayOutcome;
  /**
   * Echoed back through a `response.created` event so route handlers
   * that record per-model accounting see the resolved id.
   */
  modelId?: string;
  /** Optional text to emit as a single delta before the finish event. */
  text?: string;
  /**
   * Per-yield pause (ms) injected into `stream()` AFTER the opening
   * `response.created` event and before each subsequent event. Gives the
   * abort tests a deterministic window to cancel mid-stream by control
   * flow rather than back-pressure luck: the producer parks on a real
   * timer, so a `controller.abort()` fired after the first chunk always
   * lands while the generator is suspended inside the stream. `0` (the
   * default) still yields a macrotask boundary via `setTimeout(_, 0)`.
   */
  delayMs?: number;
}

export interface LlmGatewayMockHandle {
  /** Number of stream() / complete() calls observed. */
  readonly callCount: () => number;
  /** Most recent params (last call). */
  readonly lastParams: () => NyxLlmStreamParams | NyxLlmCompleteParams | null;
  /** Update outcome / model for the next call. */
  setNext(opts: LlmGatewayMockOptions): void;
}

/**
 * Build a fake `NyxLlmClient`-compatible object. The return value is
 * cast to the real type at the bootstrap call site — we only override
 * the two streaming methods, since the rest are private.
 */
export function installLlmGatewayMock(
  initial: LlmGatewayMockOptions = { outcome: "success", modelId: "gpt-test" },
): { client: unknown; handle: LlmGatewayMockHandle } {
  let calls = 0;
  let last: NyxLlmStreamParams | NyxLlmCompleteParams | null = null;
  let cfg: LlmGatewayMockOptions = { ...initial };

  async function* fakeStream(
    params: NyxLlmStreamParams,
  ): AsyncIterable<ResponsesApiStreamEvent> {
    calls += 1;
    last = params;
    if (cfg.outcome === "system_error") {
      throw new Error("LLM_TRANSPORT_FAIL: simulated upstream 5xx");
    }
    // Awaitable inter-event pause. Defaults to a bare macrotask boundary
    // (`setTimeout(_, 0)`) so every yield cooperatively suspends the
    // generator; abort tests bump `delayMs` so the producer is reliably
    // parked between `response.created` and `response.completed` when
    // `controller.abort()` fires.
    const pause = () =>
      new Promise<void>((resolve) => setTimeout(resolve, cfg.delayMs ?? 0));
    yield {
      type: "response.created",
      response: { model: cfg.modelId ?? params.model },
    } as ResponsesApiStreamEvent;
    await pause();
    if (cfg.text) {
      yield {
        type: "response.output_text.delta",
        delta: cfg.text,
      } as ResponsesApiStreamEvent;
      await pause();
    }
    if (cfg.outcome === "skill_error") {
      yield {
        type: "response.error",
        error: { message: "simulated skill-side failure" },
      } as ResponsesApiStreamEvent;
      await pause();
    }
    yield {
      type: "response.completed",
      response: {
        model: cfg.modelId ?? params.model,
        finishReason: cfg.outcome === "skill_error" ? "skill_error" : "stop",
      },
    } as ResponsesApiStreamEvent;
  }

  async function fakeComplete(
    params: NyxLlmCompleteParams,
  ): Promise<ResponsesApiOutput[]> {
    calls += 1;
    last = params;
    if (cfg.outcome === "system_error") {
      throw new Error("LLM_TRANSPORT_FAIL: simulated upstream 5xx");
    }
    return [
      {
        type: "message",
        content: [{ type: "output_text", text: cfg.text ?? "{}" }],
      },
    ];
  }

  const client = {
    stream: fakeStream,
    complete: fakeComplete,
  };

  const handle: LlmGatewayMockHandle = {
    callCount: () => calls,
    lastParams: () => last,
    setNext: (opts) => {
      cfg = { ...cfg, ...opts };
    },
  };

  return { client, handle };
}
