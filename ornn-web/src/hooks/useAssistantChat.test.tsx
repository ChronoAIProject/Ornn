/**
 * UT-WEB-ASSISTANT-HOOK-001 — useAssistantChat send/stream loop (#970).
 *
 * Drives the hook through a full turn against a stubbed stream client:
 * a sent message lands as a user turn, streamed deltas flush into the
 * finalized assistant message on `chat_finish`, `chat_error` toasts +
 * records the error, and abort stops streaming. The stream module is
 * mocked so the test owns the `onEvent` callback and never opens a real
 * connection; the toast store is mocked to a spy.
 *
 * @module hooks/useAssistantChat.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AssistantChatEvent } from "@/types/assistant";
import type { AssistantStreamParams, StreamHandle } from "@/services/assistantStreamApi";

// --- Stubbed stream client -------------------------------------------------
// Captures the latest (params, onEvent) so the test can replay SSE events,
// and exposes an `abort` spy on the returned handle.
let lastParams: AssistantStreamParams | null = null;
let lastOnEvent: ((e: AssistantChatEvent) => void) | null = null;
const abortSpy = vi.fn();

vi.mock("@/services/assistantStreamApi", () => ({
  streamAssistantChat: (
    params: AssistantStreamParams,
    onEvent: (e: AssistantChatEvent) => void,
  ): StreamHandle => {
    lastParams = params;
    lastOnEvent = onEvent;
    return { abort: abortSpy };
  },
}));

// --- Stubbed toast store ---------------------------------------------------
const addToast = vi.fn();
vi.mock("@/stores/toastStore", () => ({
  useToastStore: <T,>(selector: (s: { addToast: typeof addToast }) => T) =>
    selector({ addToast }),
}));

import { useAssistantChat } from "./useAssistantChat";
import { useAssistantStore } from "@/stores/assistantStore";

/** Replay one SSE event through the captured handler, inside act(). */
function emit(event: AssistantChatEvent) {
  act(() => {
    lastOnEvent?.(event);
  });
}

beforeEach(() => {
  lastParams = null;
  lastOnEvent = null;
  abortSpy.mockReset();
  addToast.mockReset();
  useAssistantStore.setState({
    isOpen: false,
    messages: [],
    isStreaming: false,
    error: null,
    currentAssistantContent: "",
  });
});

describe("useAssistantChat", () => {
  it("sends the trimmed user turn and forwards conversation + model", () => {
    const { result } = renderHook(() => useAssistantChat());

    act(() => result.current.sendMessage("  What is Ornn?  ", "gpt-5"));

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "What is Ornn?",
    });
    expect(result.current.isStreaming).toBe(true);
    expect(lastParams?.modelId).toBe("gpt-5");
    expect(lastParams?.messages).toEqual([{ role: "user", content: "What is Ornn?" }]);
  });

  it("ignores empty / whitespace-only sends", () => {
    const { result } = renderHook(() => useAssistantChat());
    act(() => result.current.sendMessage("   "));
    expect(result.current.messages).toHaveLength(0);
    expect(lastOnEvent).toBeNull();
  });

  it("flushes streamed deltas into a finalized assistant message on finish", () => {
    const { result } = renderHook(() => useAssistantChat());

    act(() => result.current.sendMessage("hi"));
    emit({ type: "chat_start", model: "gpt-5" });
    emit({ type: "chat_text_delta", delta: "Ornn " });
    emit({ type: "chat_text_delta", delta: "is a registry." });
    emit({ type: "chat_finish" });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.currentAssistantContent).toBe("");
    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Ornn is a registry.",
    });
  });

  it("toasts and records the error on chat_error", () => {
    const { result } = renderHook(() => useAssistantChat());

    act(() => result.current.sendMessage("hi"));
    emit({ type: "chat_error", code: "rate_limited", message: "Slow down" });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBe("Slow down");
    expect(addToast).toHaveBeenCalledWith({ type: "error", message: "Slow down" });
  });

  it("ignores keepalive heartbeats", () => {
    const { result } = renderHook(() => useAssistantChat());
    act(() => result.current.sendMessage("hi"));
    emit({ type: "keepalive" });
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("abort stops streaming and finalizes whatever was received", () => {
    const { result } = renderHook(() => useAssistantChat());

    act(() => result.current.sendMessage("hi"));
    emit({ type: "chat_text_delta", delta: "Partial" });
    act(() => result.current.abort());

    expect(abortSpy).toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Partial",
    });
  });

  it("clearChat empties the conversation and aborts any stream", () => {
    const { result } = renderHook(() => useAssistantChat());

    act(() => result.current.sendMessage("hi"));
    act(() => result.current.clearChat());

    expect(abortSpy).toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });
});
