/**
 * UT-WEB-ASSISTANT-EVENT-001 — assistant SSE event union (#970).
 *
 * The Zod discriminated union is the only gate between raw SSE payloads
 * and the chat UI. It must accept every contracted event, tolerate
 * forward-compatible extra `usage` keys, and reject anything malformed or
 * off-contract so a drifting backend surfaces as a dropped event rather
 * than an untyped object reaching React.
 *
 * @module types/assistant.test
 */

import { describe, it, expect } from "vitest";
import {
  assistantChatEventSchema,
  parseAssistantEvent,
  type AssistantChatEvent,
} from "./assistant";

describe("assistant SSE event union", () => {
  it("accepts chat_start", () => {
    const r = assistantChatEventSchema.safeParse({ type: "chat_start", model: "gpt-5" });
    expect(r.success).toBe(true);
  });

  it("accepts chat_text_delta", () => {
    const r = assistantChatEventSchema.safeParse({ type: "chat_text_delta", delta: "Hi" });
    expect(r.success).toBe(true);
  });

  it("accepts chat_error with code + message", () => {
    const r = assistantChatEventSchema.safeParse({
      type: "chat_error",
      code: "rate_limited",
      message: "Slow down",
    });
    expect(r.success).toBe(true);
  });

  it("accepts chat_finish with no usage", () => {
    const r = assistantChatEventSchema.safeParse({ type: "chat_finish" });
    expect(r.success).toBe(true);
  });

  it("accepts chat_finish with usage and tolerates extra usage keys", () => {
    const r = assistantChatEventSchema.safeParse({
      type: "chat_finish",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.01 },
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === "chat_finish") {
      expect(r.data.usage?.totalTokens).toBe(15);
      // Forward-compatible extra key is stripped, not retained.
      expect(r.data.usage).not.toHaveProperty("costUsd");
    }
  });

  it("accepts keepalive", () => {
    const r = assistantChatEventSchema.safeParse({ type: "keepalive" });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown event type", () => {
    const r = assistantChatEventSchema.safeParse({ type: "text-delta", delta: "x" });
    expect(r.success).toBe(false);
  });

  it("rejects chat_text_delta missing its delta", () => {
    const r = assistantChatEventSchema.safeParse({ type: "chat_text_delta" });
    expect(r.success).toBe(false);
  });

  it("rejects chat_error missing code", () => {
    const r = assistantChatEventSchema.safeParse({ type: "chat_error", message: "boom" });
    expect(r.success).toBe(false);
  });
});

describe("parseAssistantEvent", () => {
  it("returns the typed event for valid input", () => {
    const event = parseAssistantEvent({ type: "chat_text_delta", delta: "yo" });
    expect(event).toEqual({ type: "chat_text_delta", delta: "yo" });
    // Type-narrowing sanity (compile-time guarantee, asserted at runtime).
    const narrowed: AssistantChatEvent | null = event;
    expect(narrowed?.type).toBe("chat_text_delta");
  });

  it("returns null for malformed input", () => {
    expect(parseAssistantEvent({ type: "nope" })).toBeNull();
    expect(parseAssistantEvent("not an object")).toBeNull();
    expect(parseAssistantEvent(null)).toBeNull();
    expect(parseAssistantEvent({})).toBeNull();
  });
});
