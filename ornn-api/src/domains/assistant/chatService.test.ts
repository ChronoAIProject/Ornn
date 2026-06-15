/**
 * UT-ASST-CHAT-* — AssistantChatService (#970).
 *
 * Verifies the wire-contract event sequence, the structural "no tools"
 * guarantee (pure Q&A), fail-soft retrieval, error mapping, and usage.
 *
 * @module domains/assistant/chatService.test
 */

import { describe, expect, it } from "bun:test";
import type {
  NyxLlmStreamParams,
  ResponsesApiStreamEvent,
} from "../../clients/nyxid/llm";
import type { ActorContext } from "../skills/crud/authorize";
import { AssistantChatService, latestUserMessage } from "./chatService";
import type { AssistantChatEvent, RetrievedSkill } from "./types";

const ACTOR: ActorContext = {
  userId: "u-1",
  memberships: [],
  isPlatformAdmin: false,
  membershipsResolved: true,
};

const DEFAULTS = { model: "default-model", maxOutputTokens: 4096, temperature: 0.4 };

class FakeLlm {
  lastParams: NyxLlmStreamParams | null = null;
  events: ResponsesApiStreamEvent[] = [
    { type: "response.output_text.delta", delta: "Hello" },
    { type: "response.output_text.delta", delta: " world" },
  ];
  throwError: Error | null = null;
  async *stream(params: NyxLlmStreamParams): AsyncIterable<ResponsesApiStreamEvent> {
    this.lastParams = params;
    if (this.throwError) throw this.throwError;
    for (const e of this.events) yield e;
  }
}

function fakeKb(text = "Ornn KB.") {
  return { load: () => ({ text, estimatedTokens: 2, budgetTokens: 100, truncated: false }) };
}

function fakeRetriever(skills: RetrievedSkill[] = [], err?: Error) {
  return {
    retrieve: async () => {
      if (err) throw err;
      return skills;
    },
  };
}

function makeService(llm: FakeLlm, retriever = fakeRetriever()) {
  return new AssistantChatService({
    llmClient: llm,
    kbLoader: fakeKb(),
    retriever,
    defaultsResolver: async () => DEFAULTS,
  });
}

async function collect(
  gen: AsyncGenerator<AssistantChatEvent>,
): Promise<AssistantChatEvent[]> {
  const out: AssistantChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("latestUserMessage", () => {
  it("UT-ASST-CHAT-000: returns the last user turn", () => {
    expect(
      latestUserMessage([
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ]),
    ).toBe("second");
    expect(latestUserMessage([{ role: "assistant", content: "x" }])).toBe("");
  });
});

describe("AssistantChatService", () => {
  it("UT-ASST-CHAT-001: emits chat_start → deltas → chat_finish", async () => {
    const llm = new FakeLlm();
    const svc = makeService(llm);
    const events = await collect(
      svc.chat(ACTOR, { messages: [{ role: "user", content: "hi" }] }, undefined, {
        modelId: "m-explicit",
      }),
    );
    expect(events[0]).toEqual({ type: "chat_start", model: "m-explicit" });
    expect(events.filter((e) => e.type === "chat_text_delta")).toEqual([
      { type: "chat_text_delta", delta: "Hello" },
      { type: "chat_text_delta", delta: " world" },
    ]);
    expect(events[events.length - 1]!.type).toBe("chat_finish");
  });

  it("UT-ASST-CHAT-002: NEVER passes tools to the LLM (pure Q&A, no agentic loop)", async () => {
    const llm = new FakeLlm();
    await collect(
      makeService(llm).chat(
        ACTOR,
        { messages: [{ role: "user", content: "hi" }] },
        undefined,
        { modelId: "m" },
      ),
    );
    expect(llm.lastParams?.tools).toBeUndefined();
    // Grounding developer message is injected first.
    expect(llm.lastParams?.input[0]?.role).toBe("developer");
  });

  it("UT-ASST-CHAT-003: falls back to surface default model when modelId blank", async () => {
    const llm = new FakeLlm();
    const events = await collect(
      makeService(llm).chat(
        ACTOR,
        { messages: [{ role: "user", content: "hi" }] },
        undefined,
        { modelId: "" },
      ),
    );
    expect(events[0]).toEqual({ type: "chat_start", model: "default-model" });
  });

  it("UT-ASST-CHAT-004: retrieval failure is non-fatal — still answers KB-only", async () => {
    const llm = new FakeLlm();
    const svc = makeService(llm, fakeRetriever([], new Error("mongo down")));
    const events = await collect(
      svc.chat(ACTOR, { messages: [{ role: "user", content: "hi" }] }, undefined, {
        modelId: "m",
      }),
    );
    expect(events.some((e) => e.type === "chat_text_delta")).toBe(true);
    expect(events[events.length - 1]!.type).toBe("chat_finish");
  });

  it("UT-ASST-CHAT-005: stream error → chat_error with a catalog code, no finish", async () => {
    const llm = new FakeLlm();
    llm.throwError = new Error("LLM Gateway error (502): upstream down");
    const events = await collect(
      makeService(llm).chat(
        ACTOR,
        { messages: [{ role: "user", content: "hi" }] },
        undefined,
        { modelId: "m" },
      ),
    );
    const err = events.find((e) => e.type === "chat_error");
    expect(err).toBeDefined();
    if (err && err.type === "chat_error") {
      expect(err.code).toBe("upstream_unavailable");
      expect(err.message).toContain("502");
    }
    expect(events.some((e) => e.type === "chat_finish")).toBe(false);
  });

  it("UT-ASST-CHAT-006: reports usage on chat_finish when provider supplies it", async () => {
    const llm = new FakeLlm();
    llm.events = [
      { type: "response.output_text.delta", delta: "hi" },
      {
        type: "response.completed",
        response: { usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 } },
      },
    ];
    const events = await collect(
      makeService(llm).chat(
        ACTOR,
        { messages: [{ role: "user", content: "hi" }] },
        undefined,
        { modelId: "m" },
      ),
    );
    const finish = events.find((e) => e.type === "chat_finish");
    expect(finish).toEqual({
      type: "chat_finish",
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    });
  });

  it("UT-ASST-CHAT-007: aborted signal stops the stream (no finish)", async () => {
    const llm = new FakeLlm();
    const ac = new AbortController();
    ac.abort();
    const events = await collect(
      makeService(llm).chat(
        ACTOR,
        { messages: [{ role: "user", content: "hi" }] },
        ac.signal,
        { modelId: "m" },
      ),
    );
    // chat_start always emits; the loop bails on the first aborted check.
    expect(events[0]!.type).toBe("chat_start");
    expect(events.some((e) => e.type === "chat_finish")).toBe(false);
    expect(events.some((e) => e.type === "chat_text_delta")).toBe(false);
  });
});
