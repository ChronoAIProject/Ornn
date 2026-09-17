/**
 * UT-WEB-SKILL-GENERATION-HOOK-001 (#1242)
 *
 * First tests for the generation lifecycle hook. The SSE client is
 * stubbed to capture `(params, onEvent)` so the test can replay server
 * frames; the real parser builds the preview. Pins: request params
 * (messages transcript, modelId, mode), the phase machine across
 * start → tokens → complete / error, multi-turn history accumulation,
 * abort / reset, and the preview editing helpers.
 *
 * @module hooks/useSkillGeneration.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { GenerationStreamEvent } from "@/types/streaming";
import type { GenerateStreamParams, StreamHandle } from "@/services/generateStreamApi";

let lastParams: GenerateStreamParams | null = null;
let lastOnEvent: ((e: GenerationStreamEvent) => void) | null = null;
const abortSpy = vi.fn();
let streamCalls = 0;

vi.mock("@/services/generateStreamApi", () => ({
  generateSkillStream: (
    params: GenerateStreamParams,
    onEvent: (e: GenerationStreamEvent) => void,
  ): StreamHandle => {
    streamCalls += 1;
    lastParams = params;
    lastOnEvent = onEvent;
    return { abort: abortSpy };
  },
}));

import { useSkillGeneration } from "./useSkillGeneration";

const RAW_SIMPLE = JSON.stringify({
  name: "demo-skill",
  description: "A demo skill for the hook tests.",
  category: "plain",
  tags: ["demo"],
  readmeBody: "# Demo\n\nBody.",
  runtimes: [],
  dependencies: [],
  envVars: [],
  scripts: [],
  references: [],
  assets: [],
});

const RAW_ADVANCED = JSON.stringify({
  ...JSON.parse(RAW_SIMPLE),
  name: "advanced-skill",
  scripts: [{ filename: "main.js", content: "console.log(1)" }],
  references: [{ filename: "api.md", content: "# API" }],
});

/** Replay one SSE event through the captured handler, inside act(). */
function emit(event: GenerationStreamEvent) {
  act(() => {
    lastOnEvent?.(event);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  lastParams = null;
  lastOnEvent = null;
  streamCalls = 0;
  abortSpy.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSkillGeneration", () => {
  it("starts in the input phase with an empty preview", () => {
    const { result } = renderHook(() => useSkillGeneration());
    expect(result.current.phase).toBe("input");
    expect(result.current.chatMessages).toEqual([]);
    expect(result.current.metadata).toBeNull();
  });

  it("sendMessage forwards the transcript, modelId and mode (#1242)", () => {
    const { result } = renderHook(() => useSkillGeneration());
    act(() => result.current.sendMessage("build a thing", { modelId: "m-1", mode: "simple" }));
    expect(lastParams).toEqual({
      messages: [{ role: "user", content: "build a thing" }],
      modelId: "m-1",
      mode: "simple",
    });
    expect(result.current.phase).toBe("generating");
    // User turn + streaming assistant placeholder.
    expect(result.current.chatMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(result.current.chatMessages[1]!.isStreaming).toBe(true);
  });

  it("sendMessage without options sends neither modelId nor mode", () => {
    const { result } = renderHook(() => useSkillGeneration());
    act(() => result.current.sendMessage("x"));
    expect(lastParams?.modelId).toBeUndefined();
    expect(lastParams?.mode).toBeUndefined();
  });

  it("generation_complete parses the package into the preview and closes the turn", () => {
    const { result } = renderHook(() => useSkillGeneration());
    act(() => result.current.sendMessage("x", { mode: "simple" }));
    emit({ type: "generation_start" });
    emit({ type: "generation_complete", raw: RAW_SIMPLE });

    expect(result.current.phase).toBe("preview");
    expect(result.current.metadata?.name).toBe("demo-skill");
    expect([...result.current.fileContents.keys()]).toEqual(["SKILL.md"]);
    const assistant = result.current.chatMessages[1]!;
    expect(assistant.isStreaming).toBe(false);
    expect(assistant.skillName).toBe("demo-skill");
    expect(assistant.content).toBe("Generated skill: demo-skill");
    // The model's raw answer is appended to the history for the next turn.
    expect(result.current.conversationHistory).toEqual([
      { role: "user", content: "x" },
      { role: "assistant", content: RAW_SIMPLE },
    ]);
  });

  it("advanced output lands scripts/ and references/ in the preview", () => {
    const { result } = renderHook(() => useSkillGeneration());
    act(() => result.current.sendMessage("x", { mode: "advanced" }));
    emit({ type: "generation_complete", raw: RAW_ADVANCED });
    expect([...result.current.fileContents.keys()].sort()).toEqual(
      ["SKILL.md", "references/api.md", "scripts/main.js"].sort(),
    );
  });

  it("a refinement turn resends the whole transcript with the current mode", () => {
    const { result } = renderHook(() => useSkillGeneration());
    act(() => result.current.sendMessage("first", { mode: "advanced" }));
    emit({ type: "generation_complete", raw: RAW_SIMPLE });
    act(() => result.current.sendMessage("now simpler", { mode: "simple" }));

    expect(streamCalls).toBe(2);
    expect(lastParams?.mode).toBe("simple");
    expect(lastParams?.messages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: RAW_SIMPLE },
      { role: "user", content: "now simpler" },
    ]);
  });

  it("batches token frames into the streaming assistant message", () => {
    const { result } = renderHook(() => useSkillGeneration());
    act(() => result.current.sendMessage("x"));
    emit({ type: "token", content: "{\"na" });
    emit({ type: "token", content: "me\":" });
    // Nothing visible until the flush timer fires.
    expect(result.current.streamingTokens).toBe("");
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(result.current.streamingTokens).toBe("{\"name\":");
    expect(result.current.chatMessages[1]!.content).toBe("{\"name\":");
  });

  it("error frame moves to the error phase and marks the assistant turn", () => {
    const { result } = renderHook(() => useSkillGeneration());
    act(() => result.current.sendMessage("x", { mode: "simple" }));
    emit({ type: "generation_start" });
    emit({
      type: "validation_error",
      message: "Simple mode allows SKILL.md only, but the model emitted: scripts",
      retrying: true,
    });
    emit({ type: "error", message: "LLM produced advanced materials in simple mode after retry" });

    expect(result.current.phase).toBe("error");
    expect(result.current.error).toContain("simple mode after retry");
    const assistant = result.current.chatMessages[1]!;
    expect(assistant.isStreaming).toBe(false);
    expect(assistant.content).toContain("Error:");
    expect(result.current.metadata).toBeNull();
  });

  it("abort() cancels the stream and finalises the streaming message", () => {
    const { result } = renderHook(() => useSkillGeneration());
    act(() => result.current.sendMessage("x"));
    emit({ type: "token", content: "partial" });
    act(() => result.current.abort());
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(result.current.chatMessages[1]!.isStreaming).toBe(false);
    expect(result.current.chatMessages[1]!.content).toBe("partial");
  });

  it("reset() returns to the initial state and clears the transcript", () => {
    const { result } = renderHook(() => useSkillGeneration());
    act(() => result.current.sendMessage("x"));
    emit({ type: "generation_complete", raw: RAW_SIMPLE });
    act(() => result.current.reset());
    expect(result.current.phase).toBe("input");
    expect(result.current.chatMessages).toEqual([]);
    expect(result.current.conversationHistory).toEqual([]);
    expect(result.current.metadata).toBeNull();
    // A fresh send after reset starts a new transcript.
    act(() => result.current.sendMessage("again"));
    expect(lastParams?.messages).toEqual([{ role: "user", content: "again" }]);
  });

  it("updateFileContent and deleteFile edit the preview in place", () => {
    const { result } = renderHook(() => useSkillGeneration());
    act(() => result.current.sendMessage("x"));
    emit({ type: "generation_complete", raw: RAW_ADVANCED });

    act(() => result.current.updateFileContent("scripts/main.js", "console.log(2)"));
    expect(result.current.fileContents.get("scripts/main.js")).toBe("console.log(2)");

    act(() => result.current.deleteFile("references/api.md"));
    expect(result.current.fileContents.has("references/api.md")).toBe(false);
    const root = result.current.parsedFiles[0]!;
    const refs = root.children!.find((n) => n.id === "references");
    expect(refs?.children).toEqual([]);
  });
});
