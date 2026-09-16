/**
 * Unit tests for the SkillGenerationService (#875).
 *
 * The service is DI-driven: a `NyxLlmClient` (faked at the typed
 * AsyncIterable seam) + a `defaultsResolver`. No real network / DB /
 * LLM is touched. The fake client exposes the same two methods the
 * service calls — `stream()` (async generator of
 * `ResponsesApiStreamEvent`) and `complete()` (returns
 * `ResponsesApiOutput[]`) — and is cast through `unknown` to the real
 * `NyxLlmClient` type so the call sites stay honest.
 *
 * Coverage:
 *   - extractTextFromEvent: both delta shapes + unknown type → null
 *     (exercised end-to-end via generateStream token accumulation).
 *   - resolveDefaults: happy / empty / whitespace-only model throws
 *     SKILLGEN_LLM_NOT_CONFIGURED / modelOverride wins.
 *   - generateStream: happy / pre-abort / mid-abort / stream-throw /
 *     invalid-then-retry-success / retry-throw / retry-still-invalid /
 *     resolver-throw.
 *   - generateStreamWithHistory: first-msg rewrite + assistant
 *     passthrough / non-retry validation_error / pass / abort + throw.
 *   - generateFromOpenApi / generateFromSource: happy + invalid +
 *     option pass-through.
 *   - mode (#1242): simple/advanced prompt selection, simple-mode
 *     violation → corrective retry → success / error on both the
 *     single-turn and multi-turn paths, advanced pass-through of
 *     references/assets. Parsing itself is pinned in validation.test.ts.
 *
 * @module domains/skills/generation/service.test
 */

import { describe, expect, test } from "bun:test";
import { SkillGenerationService } from "./service";
import type {
  SkillGenLlmDefaults,
  SkillGenLlmDefaultsResolver,
} from "./service";
import type {
  NyxLlmClient,
  NyxLlmStreamParams,
  NyxLlmCompleteParams,
  ResponsesApiStreamEvent,
  ResponsesApiOutput,
} from "../../../clients/nyxid/llm";
import type { SkillStreamEvent } from "../../../shared/types/index";
import {
  GENERATION_SYSTEM_PROMPT,
  SIMPLE_GENERATION_SYSTEM_PROMPT,
  SIMPLE_MODE_RETRY_INSTRUCTION,
} from "./prompts";

// ---- Fixtures --------------------------------------------------------

const DEFAULTS: SkillGenLlmDefaults = {
  model: "default-model",
  maxOutputTokens: 4096,
  temperature: 0.5,
};

/** A schema-valid generated-skill JSON document. */
const VALID_SKILL = JSON.stringify({
  name: "demo-skill",
  description: "A perfectly valid demo skill for testing purposes.",
  category: "plain",
  tags: ["demo", "test"],
  readmeBody:
    "# Demo Skill\n\nThis readme body is comfortably over the fifty character minimum length.",
  runtimes: [],
  dependencies: [],
  envVars: [],
  scripts: [],
});

/** Schema-valid but carries a script — legal in advanced, illegal in simple. */
const SCRIPTED_SKILL = JSON.stringify({
  name: "scripted-skill",
  description: "A runtime-based skill that ships a script and a reference.",
  category: "runtime-based",
  outputType: "text",
  tags: ["demo"],
  readmeBody:
    "# Scripted Skill\n\nThis readme body is comfortably over the fifty character minimum length.",
  runtimes: ["node"],
  dependencies: ["axios"],
  envVars: ["API_KEY"],
  scripts: [{ filename: "main.js", content: "console.log('hi')" }],
  references: [{ filename: "notes.md", content: "# Notes" }],
  assets: [],
});

// ---- Responses-API stream frame helpers ------------------------------

/** `response.output_text.delta` frame ({ delta: string }). */
function outputTextDelta(text: string): ResponsesApiStreamEvent {
  return { type: "response.output_text.delta", delta: text };
}

/** `response.content_part.delta` frame ({ delta: { type, text } }). */
function contentPartDelta(text: string): ResponsesApiStreamEvent {
  return {
    type: "response.content_part.delta",
    delta: { type: "output_text", text },
  };
}

/** An event the extractor must ignore (returns null → no token). */
function unknownFrame(): ResponsesApiStreamEvent {
  return { type: "response.something.else", foo: "bar" };
}

/** A `complete()` output carrying text in the Responses-API shape. */
function completeOutput(text: string): ResponsesApiOutput[] {
  return [{ type: "message", content: [{ type: "output_text", text }] }];
}

// ---- Fake NyxLlmClient -----------------------------------------------

interface FakeClientOpts {
  /** Frames the stream() generator yields, in order. */
  streamFrames?: ResponsesApiStreamEvent[];
  /** When set, stream() throws this after yielding `throwAfter` frames. */
  streamThrow?: Error;
  /** Yield this many frames before throwing (default 0 = throw first). */
  throwAfter?: number;
  /** complete() result — output array. */
  completeResult?: ResponsesApiOutput[];
  /** When set, complete() throws this. */
  completeThrow?: Error;
  /** Optional callback invoked once between each stream frame yield. */
  onFrame?: (index: number) => void;
}

function makeClient(opts: FakeClientOpts): {
  client: NyxLlmClient;
  streamParams: NyxLlmStreamParams[];
  completeParams: NyxLlmCompleteParams[];
} {
  const streamParams: NyxLlmStreamParams[] = [];
  const completeParams: NyxLlmCompleteParams[] = [];
  const {
    streamFrames = [],
    streamThrow,
    throwAfter = 0,
    completeResult = [],
    completeThrow,
    onFrame,
  } = opts;

  const fake = {
    async *stream(params: NyxLlmStreamParams): AsyncIterable<ResponsesApiStreamEvent> {
      streamParams.push(params);
      let i = 0;
      for (const frame of streamFrames) {
        if (streamThrow && i >= throwAfter) throw streamThrow;
        yield frame;
        onFrame?.(i);
        i += 1;
      }
      if (streamThrow && i >= throwAfter) throw streamThrow;
    },
    async complete(params: NyxLlmCompleteParams): Promise<ResponsesApiOutput[]> {
      completeParams.push(params);
      if (completeThrow) throw completeThrow;
      return completeResult;
    },
  };

  return { client: fake as unknown as NyxLlmClient, streamParams, completeParams };
}

function makeResolver(
  value: SkillGenLlmDefaults | (() => Promise<SkillGenLlmDefaults>),
): SkillGenLlmDefaultsResolver {
  if (typeof value === "function") return value;
  return async () => value;
}

async function drain(
  it: AsyncIterable<SkillStreamEvent>,
): Promise<SkillStreamEvent[]> {
  const out: SkillStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function types(events: SkillStreamEvent[]): string[] {
  return events.map((e) => e.type);
}

// ---- resolveDefaults (via generateStream) ----------------------------

describe("resolveDefaults", () => {
  test("happy path resolves and threads model into the stream call", async () => {
    const { client, streamParams } = makeClient({
      streamFrames: [outputTextDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q"));
    expect(types(events)).toContain("generation_complete");
    expect(streamParams[0]!.model).toBe("default-model");
    expect(streamParams[0]!.max_output_tokens).toBe(4096);
    expect(streamParams[0]!.temperature).toBe(0.5);
  });

  test("empty model string yields SKILLGEN_LLM_NOT_CONFIGURED error", async () => {
    const { client } = makeClient({});
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver({ ...DEFAULTS, model: "" }),
    });
    const events = await drain(svc.generateStream("q"));
    expect(types(events)).toEqual(["error"]);
    expect((events[0] as { message: string }).message).toContain(
      "SKILLGEN_LLM_NOT_CONFIGURED",
    );
  });

  test("whitespace-only model string also throws not-configured", async () => {
    const { client } = makeClient({});
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver({ ...DEFAULTS, model: "   " }),
    });
    const events = await drain(svc.generateStream("q"));
    expect(types(events)).toEqual(["error"]);
    expect((events[0] as { message: string }).message).toContain(
      "SKILLGEN_LLM_NOT_CONFIGURED",
    );
  });

  test("modelOverride wins over the resolved default", async () => {
    const { client, streamParams } = makeClient({
      streamFrames: [outputTextDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    await drain(svc.generateStream("q", { modelOverride: "override-model" }));
    expect(streamParams[0]!.model).toBe("override-model");
  });

  test("resolver throwing surfaces a single error event then returns", async () => {
    const { client } = makeClient({});
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(async () => {
        throw new Error("settings collection unreachable");
      }),
    });
    const events = await drain(svc.generateStream("q"));
    expect(types(events)).toEqual(["error"]);
    expect((events[0] as { message: string }).message).toContain(
      "settings collection unreachable",
    );
  });
});

// ---- extractTextFromEvent (via token accumulation) -------------------

describe("extractTextFromEvent", () => {
  test("accumulates from response.output_text.delta frames", async () => {
    const half = VALID_SKILL.slice(0, 20);
    const rest = VALID_SKILL.slice(20);
    const { client } = makeClient({
      streamFrames: [outputTextDelta(half), outputTextDelta(rest)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q"));
    const complete = events.find((e) => e.type === "generation_complete");
    expect((complete as { raw: string }).raw).toBe(VALID_SKILL);
  });

  test("accumulates from response.content_part.delta frames", async () => {
    const { client } = makeClient({
      streamFrames: [contentPartDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q"));
    expect(types(events)).toContain("generation_complete");
  });

  test("unknown frame types are skipped (no token emitted)", async () => {
    const { client } = makeClient({
      streamFrames: [unknownFrame(), outputTextDelta(VALID_SKILL), unknownFrame()],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q"));
    const tokens = events.filter((e) => e.type === "token");
    expect(tokens).toHaveLength(1);
  });

  test("content_part.delta with wrong inner type emits no token", async () => {
    const badFrame: ResponsesApiStreamEvent = {
      type: "response.content_part.delta",
      delta: { type: "not_output_text", text: "ignored" },
    };
    const { client } = makeClient({
      streamFrames: [badFrame, outputTextDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q"));
    expect(events.filter((e) => e.type === "token")).toHaveLength(1);
  });
});

// ---- generateStream --------------------------------------------------

describe("generateStream", () => {
  test("happy sequence: start → token(s) → complete", async () => {
    const { client } = makeClient({
      streamFrames: [outputTextDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q"));
    expect(types(events)).toEqual([
      "generation_start",
      "token",
      "generation_complete",
    ]);
  });

  test("pre-aborted signal yields error before any LLM call", async () => {
    const { client, streamParams } = makeClient({
      streamFrames: [outputTextDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await drain(svc.generateStream("q", { signal: ctrl.signal }));
    expect(types(events)).toEqual(["error"]);
    expect(streamParams).toHaveLength(0);
  });

  test("mid-stream abort (flipped between frames) stops with error", async () => {
    const ctrl = new AbortController();
    const { client } = makeClient({
      streamFrames: [outputTextDelta("part-one"), outputTextDelta("part-two")],
      onFrame: (i) => {
        if (i === 0) ctrl.abort();
      },
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q", { signal: ctrl.signal }));
    expect(types(events)).toContain("error");
    expect(types(events)).not.toContain("generation_complete");
  });

  test("stream throwing surfaces an LLM error event", async () => {
    const { client } = makeClient({
      streamFrames: [outputTextDelta("partial")],
      streamThrow: new Error("gateway 502"),
      throwAfter: 1,
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q"));
    const err = events.find((e) => e.type === "error");
    expect((err as { message: string }).message).toContain("gateway 502");
    expect(types(events)).not.toContain("generation_complete");
  });

  test("invalid accumulated output retries via complete() and succeeds", async () => {
    const { client, completeParams } = makeClient({
      streamFrames: [outputTextDelta("not json at all")],
      completeResult: completeOutput(VALID_SKILL),
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q"));
    expect(types(events)).toContain("validation_error");
    expect(
      (events.find((e) => e.type === "validation_error") as { retrying: boolean })
        .retrying,
    ).toBe(true);
    const complete = events.find((e) => e.type === "generation_complete");
    expect((complete as { raw: string }).raw).toBe(VALID_SKILL);
    expect(completeParams).toHaveLength(1);
  });

  test("retry complete() throwing surfaces an LLM retry error", async () => {
    const { client } = makeClient({
      streamFrames: [outputTextDelta("garbage")],
      completeThrow: new Error("retry gateway timeout"),
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q"));
    expect(types(events)).toContain("validation_error");
    const err = events.find((e) => e.type === "error");
    expect((err as { message: string }).message).toContain("retry gateway timeout");
    expect(types(events)).not.toContain("generation_complete");
  });

  test("retry still invalid yields a terminal error", async () => {
    const { client } = makeClient({
      streamFrames: [outputTextDelta("garbage")],
      completeResult: completeOutput("still not json"),
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateStream("q"));
    expect(types(events)).toContain("validation_error");
    const err = events.find((e) => e.type === "error");
    expect((err as { message: string }).message).toContain("after retry");
    expect(types(events)).not.toContain("generation_complete");
  });
});

// ---- generateStream × mode (#1242) -----------------------------------

describe("generateStream mode", () => {
  function make(opts: FakeClientOpts) {
    const made = makeClient(opts);
    const svc = new SkillGenerationService({
      llmClient: made.client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    return { ...made, svc };
  }

  test("default mode is advanced: scripted output passes and the advanced prompt is sent", async () => {
    const { svc, streamParams } = make({ streamFrames: [outputTextDelta(SCRIPTED_SKILL)] });
    const events = await drain(svc.generateStream("q"));
    expect(types(events)).toEqual(["generation_start", "token", "generation_complete"]);
    expect(streamParams[0]!.input[0]!.content).toBe(GENERATION_SYSTEM_PROMPT);
  });

  test("mode=advanced: references/assets travel through generation_complete.raw", async () => {
    const { svc } = make({ streamFrames: [outputTextDelta(SCRIPTED_SKILL)] });
    const events = await drain(svc.generateStream("q", { mode: "advanced" }));
    const complete = events.find((e) => e.type === "generation_complete") as { raw: string };
    expect(JSON.parse(complete.raw).references).toHaveLength(1);
  });

  test("mode=simple sends the simple prompt and accepts a plain SKILL.md-only answer", async () => {
    const { svc, streamParams, completeParams } = make({ streamFrames: [outputTextDelta(VALID_SKILL)] });
    const events = await drain(svc.generateStream("q", { mode: "simple" }));
    expect(types(events)).toEqual(["generation_start", "token", "generation_complete"]);
    expect(streamParams[0]!.input[0]!.content).toBe(SIMPLE_GENERATION_SYSTEM_PROMPT);
    expect(completeParams).toHaveLength(0);
  });

  test("mode=simple: scripted answer → validation_error(retrying) → corrective retry → complete", async () => {
    const { svc, completeParams } = make({
      streamFrames: [outputTextDelta(SCRIPTED_SKILL)],
      completeResult: completeOutput(VALID_SKILL),
    });
    const events = await drain(svc.generateStream("q", { mode: "simple" }));
    expect(types(events)).toEqual([
      "generation_start",
      "token",
      "validation_error",
      "generation_complete",
    ]);
    const ve = events.find((e) => e.type === "validation_error") as { message: string; retrying: boolean };
    expect(ve.retrying).toBe(true);
    expect(ve.message).toContain("Simple mode");
    expect(ve.message).toContain("scripts");
    // The retry carries the simple-mode instruction, not the generic JSON one.
    expect(completeParams).toHaveLength(1);
    const retryUser = completeParams[0]!.input.at(-1)!.content;
    expect(retryUser).toContain(SIMPLE_MODE_RETRY_INSTRUCTION);
    expect(completeParams[0]!.input[0]!.content).toBe(SIMPLE_GENERATION_SYSTEM_PROMPT);
    const complete = events.find((e) => e.type === "generation_complete") as { raw: string };
    expect(complete.raw).toBe(VALID_SKILL);
  });

  test("mode=simple: retry that still carries files ends in error, never generation_complete", async () => {
    const { svc } = make({
      streamFrames: [outputTextDelta(SCRIPTED_SKILL)],
      completeResult: completeOutput(SCRIPTED_SKILL),
    });
    const events = await drain(svc.generateStream("q", { mode: "simple" }));
    expect(types(events)).not.toContain("generation_complete");
    const err = events.find((e) => e.type === "error") as { message: string };
    expect(err.message).toContain("simple mode after retry");
  });

  test("mode=simple: invalid JSON first, scripted on retry → error (guarantee holds across reasons)", async () => {
    const { svc, completeParams } = make({
      streamFrames: [outputTextDelta("not json")],
      completeResult: completeOutput(SCRIPTED_SKILL),
    });
    const events = await drain(svc.generateStream("q", { mode: "simple" }));
    // First rejection was JSON, so the generic instruction is used …
    expect(completeParams[0]!.input.at(-1)!.content).not.toContain(SIMPLE_MODE_RETRY_INSTRUCTION);
    // … but the retry is still validated against simple mode.
    expect(types(events)).not.toContain("generation_complete");
    expect(types(events)).toContain("error");
  });

  test("mode=simple: abort flipped after the first answer skips the retry", async () => {
    const ctrl = new AbortController();
    const { svc, completeParams } = make({
      streamFrames: [outputTextDelta(SCRIPTED_SKILL)],
      completeResult: completeOutput(VALID_SKILL),
      // Abort AFTER the last frame is yielded: the stream loop sees the
      // signal only on the next iteration, so accumulation completes and
      // validation runs, but the retry must not fire.
      onFrame: () => ctrl.abort(),
    });
    const events = await drain(svc.generateStream("q", { mode: "simple", signal: ctrl.signal }));
    expect(completeParams).toHaveLength(0);
    expect(types(events)).toContain("validation_error");
    expect(types(events)).toContain("error");
    expect(types(events)).not.toContain("generation_complete");
  });
});

// ---- generateStreamWithHistory ---------------------------------------

describe("generateStreamWithHistory", () => {
  test("rewrites the first user message and passes assistant turns through", async () => {
    const { client, streamParams } = makeClient({
      streamFrames: [outputTextDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    await drain(
      svc.generateStreamWithHistory([
        { role: "user", content: "a calculator" },
        { role: "assistant", content: "ok here is a draft" },
        { role: "user", content: "make it support hex" },
      ]),
    );
    const input = streamParams[0]!.input;
    // [0] developer system prompt, [1] rewritten first user msg.
    expect(input[0]!.role).toBe("developer");
    expect(input[1]!.role).toBe("user");
    expect(input[1]!.content).toBe('Generate a skill for: "a calculator"');
    // Assistant turn preserved verbatim.
    expect(input[2]!.role).toBe("assistant");
    expect(input[2]!.content).toBe("ok here is a draft");
    // Subsequent user turn NOT rewritten.
    expect(input[3]!.content).toBe("make it support hex");
  });

  test("invalid output emits a non-retry validation_error then complete", async () => {
    const { client } = makeClient({
      streamFrames: [outputTextDelta("not valid json")],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(
      svc.generateStreamWithHistory([{ role: "user", content: "x" }]),
    );
    const ve = events.find((e) => e.type === "validation_error");
    expect((ve as { retrying: boolean }).retrying).toBe(false);
    // History path never retries — it still emits generation_complete.
    expect(types(events)).toContain("generation_complete");
  });

  test("valid output passes through to generation_complete", async () => {
    const { client } = makeClient({
      streamFrames: [outputTextDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(
      svc.generateStreamWithHistory([{ role: "user", content: "x" }]),
    );
    expect(types(events)).not.toContain("validation_error");
    expect(types(events)).toContain("generation_complete");
  });

  test("pre-aborted signal yields error before any LLM call", async () => {
    const { client, streamParams } = makeClient({
      streamFrames: [outputTextDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await drain(
      svc.generateStreamWithHistory([{ role: "user", content: "x" }], { signal: ctrl.signal }),
    );
    expect(types(events)).toEqual(["error"]);
    expect(streamParams).toHaveLength(0);
  });

  test("stream throwing surfaces an LLM error event", async () => {
    const { client } = makeClient({
      streamFrames: [outputTextDelta("partial")],
      streamThrow: new Error("multi-turn 503"),
      throwAfter: 1,
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(
      svc.generateStreamWithHistory([{ role: "user", content: "x" }]),
    );
    const err = events.find((e) => e.type === "error");
    expect((err as { message: string }).message).toContain("multi-turn 503");
  });
});

// ---- generateStreamWithHistory × mode (#1242) ------------------------

describe("generateStreamWithHistory mode", () => {
  function make(opts: FakeClientOpts) {
    const made = makeClient(opts);
    const svc = new SkillGenerationService({
      llmClient: made.client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    return { ...made, svc };
  }
  const turn = [{ role: "user" as const, content: "x" }];

  test("mode=simple selects the simple system prompt", async () => {
    const { svc, streamParams } = make({ streamFrames: [outputTextDelta(VALID_SKILL)] });
    const events = await drain(svc.generateStreamWithHistory(turn, { mode: "simple" }));
    expect(streamParams[0]!.input[0]!.content).toBe(SIMPLE_GENERATION_SYSTEM_PROMPT);
    expect(types(events)).toEqual(["generation_start", "token", "generation_complete"]);
  });

  test("mode=advanced (default) accepts scripted output without retry", async () => {
    const { svc, completeParams } = make({ streamFrames: [outputTextDelta(SCRIPTED_SKILL)] });
    const events = await drain(svc.generateStreamWithHistory(turn));
    expect(types(events)).toEqual(["generation_start", "token", "generation_complete"]);
    expect(completeParams).toHaveLength(0);
  });

  test("mode=simple: invalid JSON still follows the no-retry multi-turn rule", async () => {
    const { svc, completeParams } = make({ streamFrames: [outputTextDelta("prose reply")] });
    const events = await drain(svc.generateStreamWithHistory(turn, { mode: "simple" }));
    expect(completeParams).toHaveLength(0);
    const ve = events.find((e) => e.type === "validation_error") as { retrying: boolean };
    expect(ve.retrying).toBe(false);
    expect(types(events)).toContain("generation_complete");
  });

  test("mode=simple: scripted answer is retried as a conversation turn and can succeed", async () => {
    const { svc, completeParams } = make({
      streamFrames: [outputTextDelta(SCRIPTED_SKILL)],
      completeResult: completeOutput(VALID_SKILL),
    });
    const events = await drain(svc.generateStreamWithHistory(turn, { mode: "simple" }));
    expect(types(events)).toEqual([
      "generation_start",
      "token",
      "validation_error",
      "generation_complete",
    ]);
    expect((events[2] as { retrying: boolean }).retrying).toBe(true);
    // Retry input = original conversation + offending assistant turn + corrective user turn.
    const input = completeParams[0]!.input;
    expect(input.at(-2)).toEqual({ role: "assistant", content: SCRIPTED_SKILL });
    expect(input.at(-1)).toEqual({ role: "user", content: SIMPLE_MODE_RETRY_INSTRUCTION });
    expect((events[3] as { raw: string }).raw).toBe(VALID_SKILL);
  });

  test("mode=simple: scripted answer twice ends in error with no generation_complete", async () => {
    const { svc } = make({
      streamFrames: [outputTextDelta(SCRIPTED_SKILL)],
      completeResult: completeOutput(SCRIPTED_SKILL),
    });
    const events = await drain(svc.generateStreamWithHistory(turn, { mode: "simple" }));
    expect(types(events)).toEqual(["generation_start", "token", "validation_error", "error"]);
  });

  test("mode=simple: retry call throwing surfaces an LLM retry error", async () => {
    const { svc } = make({
      streamFrames: [outputTextDelta(SCRIPTED_SKILL)],
      completeThrow: new Error("retry 502"),
    });
    const events = await drain(svc.generateStreamWithHistory(turn, { mode: "simple" }));
    const err = events.find((e) => e.type === "error") as { message: string };
    expect(err.message).toContain("retry 502");
    expect(types(events)).not.toContain("generation_complete");
  });
});

// ---- generateFromOpenApi ---------------------------------------------

describe("generateFromOpenApi", () => {
  test("happy path streams tokens to generation_complete", async () => {
    const { client, streamParams } = makeClient({
      streamFrames: [outputTextDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(
      svc.generateFromOpenApi('{"openapi":"3.0.0"}', {
        endpoints: ["GET /x"],
        description: "ctx",
      }),
    );
    expect(types(events)).toContain("generation_complete");
    // Defence-in-depth: option fragments flow through the builder.
    const userMsg = streamParams[0]!.input[1]!.content as string;
    expect(userMsg).toContain("Focus ONLY on these endpoints: GET /x");
    expect(userMsg).toContain("Additional context: ctx");
  });

  test("invalid output emits a non-retry validation_error then complete", async () => {
    const { client } = makeClient({
      streamFrames: [outputTextDelta("not json")],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateFromOpenApi('{"openapi":"3.0.0"}'));
    const ve = events.find((e) => e.type === "validation_error");
    expect((ve as { retrying: boolean }).retrying).toBe(false);
    expect(types(events)).toContain("generation_complete");
  });
});

// ---- generateFromSource ----------------------------------------------

describe("generateFromSource", () => {
  test("happy path streams tokens to generation_complete + passes options", async () => {
    const { client, streamParams } = makeClient({
      streamFrames: [outputTextDelta(VALID_SKILL)],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(
      svc.generateFromSource("// FILE: r.ts\napp.get('/x', h);", {
        framework: "hono",
        description: "ctx",
        sourceUrl: "https://github.com/acme/api",
      }),
    );
    expect(types(events)).toContain("generation_complete");
    const userMsg = streamParams[0]!.input[1]!.content as string;
    expect(userMsg).toContain("Detected framework hint: hono.");
    expect(userMsg).toContain("https://github.com/acme/api");
    expect(userMsg).toContain("Additional context: ctx");
    expect(userMsg).toContain("--- SOURCE CODE ---");
  });

  test("invalid output emits a non-retry validation_error then complete", async () => {
    const { client } = makeClient({
      streamFrames: [outputTextDelta("garbage")],
    });
    const svc = new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
    const events = await drain(svc.generateFromSource("code"));
    const ve = events.find((e) => e.type === "validation_error");
    expect((ve as { retrying: boolean }).retrying).toBe(false);
    expect(types(events)).toContain("generation_complete");
  });
});
