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
 *   - parseAndValidate: fence strip / brace slice / readmeMd migration
 *     (with + without frontmatter) / schema-fail / non-JSON.
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
    await drain(svc.generateStream("q", undefined, "override-model"));
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
    const events = await drain(svc.generateStream("q", ctrl.signal));
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
    const events = await drain(svc.generateStream("q", ctrl.signal));
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
      svc.generateStreamWithHistory([{ role: "user", content: "x" }], ctrl.signal),
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

// ---- parseAndValidate (direct) ---------------------------------------

describe("parseAndValidate", () => {
  function svc(): SkillGenerationService {
    const { client } = makeClient({});
    return new SkillGenerationService({
      llmClient: client,
      defaultsResolver: makeResolver(DEFAULTS),
    });
  }

  test("strips a ```json fence", () => {
    const out = svc().parseAndValidate("```json\n" + VALID_SKILL + "\n```");
    expect(out).not.toBeNull();
    expect(out!.name).toBe("demo-skill");
  });

  test("strips a bare ``` fence", () => {
    const out = svc().parseAndValidate("```\n" + VALID_SKILL + "\n```");
    expect(out).not.toBeNull();
  });

  test("slices the brace span out of prose-wrapped output", () => {
    const out = svc().parseAndValidate(
      "Sure! Here is your skill:\n" + VALID_SKILL + "\nHope that helps.",
    );
    expect(out).not.toBeNull();
    expect(out!.name).toBe("demo-skill");
  });

  test("migrates readmeMd → readmeBody, stripping YAML frontmatter", () => {
    const withFrontmatter = JSON.stringify({
      name: "legacy-skill",
      description: "A legacy skill carrying readmeMd with frontmatter.",
      category: "plain",
      tags: ["legacy"],
      readmeMd:
        "---\ntitle: Legacy\nfoo: bar\n---\n# Legacy Skill\n\nBody content that is well over the fifty character minimum requirement.",
      runtimes: [],
      dependencies: [],
      envVars: [],
      scripts: [],
    });
    const out = svc().parseAndValidate(withFrontmatter);
    expect(out).not.toBeNull();
    expect(out!.readmeBody).toContain("# Legacy Skill");
    expect(out!.readmeBody).not.toContain("title: Legacy");
  });

  test("migrates readmeMd → readmeBody when there is no frontmatter", () => {
    const noFrontmatter = JSON.stringify({
      name: "legacy-plain",
      description: "A legacy skill carrying readmeMd without frontmatter.",
      category: "plain",
      tags: ["legacy"],
      readmeMd:
        "# Plain Legacy\n\nThis body has no YAML frontmatter and is over the fifty char minimum.",
      runtimes: [],
      dependencies: [],
      envVars: [],
      scripts: [],
    });
    const out = svc().parseAndValidate(noFrontmatter);
    expect(out).not.toBeNull();
    expect(out!.readmeBody).toContain("# Plain Legacy");
  });

  test("schema violation returns null", () => {
    const badSchema = JSON.stringify({
      name: "Bad Name With Spaces",
      description: "short",
      category: "plain",
      tags: [],
      readmeBody: "too short",
      runtimes: [],
      dependencies: [],
      envVars: [],
      scripts: [],
    });
    expect(svc().parseAndValidate(badSchema)).toBeNull();
  });

  test("non-JSON input returns null", () => {
    expect(svc().parseAndValidate("this is not json at all")).toBeNull();
  });
});
