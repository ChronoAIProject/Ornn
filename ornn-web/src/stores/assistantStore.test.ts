/**
 * UT-WEB-ASSISTANT-STORE-001 — assistant store actions (#970).
 *
 * Verifies the session-scoped conversation/streaming/panel state machine:
 * user + assistant turns accumulate in order, the live buffer finalizes
 * into a message, and clearing/streaming/panel toggles behave.
 *
 * @module stores/assistantStore.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useAssistantStore } from "./assistantStore";

function reset() {
  useAssistantStore.setState({
    isOpen: false,
    messages: [],
    isStreaming: false,
    error: null,
    currentAssistantContent: "",
  });
}

describe("assistantStore", () => {
  beforeEach(reset);

  it("adds a user message and clears any prior error", () => {
    useAssistantStore.getState().setError("old");
    useAssistantStore.getState().addUserMessage("What is Ornn?");
    const s = useAssistantStore.getState();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ role: "user", content: "What is Ornn?" });
    expect(s.error).toBeNull();
  });

  it("assigns unique ids to successive messages", () => {
    const s = useAssistantStore.getState();
    s.addUserMessage("a");
    s.addUserMessage("b");
    const ids = useAssistantStore.getState().messages.map((m) => m.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("buffers streamed deltas and finalizes into an assistant message", () => {
    const s = useAssistantStore.getState();
    s.startAssistantMessage();
    s.appendAssistantDelta("Hel");
    s.appendAssistantDelta("lo");
    expect(useAssistantStore.getState().currentAssistantContent).toBe("Hello");

    s.finalizeAssistantMessage();
    const after = useAssistantStore.getState();
    expect(after.currentAssistantContent).toBe("");
    expect(after.messages.at(-1)).toMatchObject({ role: "assistant", content: "Hello" });
  });

  it("does not push an empty assistant message on finalize", () => {
    const s = useAssistantStore.getState();
    s.startAssistantMessage();
    s.finalizeAssistantMessage();
    expect(useAssistantStore.getState().messages).toHaveLength(0);
  });

  it("toggles panel open/closed", () => {
    const s = useAssistantStore.getState();
    expect(useAssistantStore.getState().isOpen).toBe(false);
    s.openPanel();
    expect(useAssistantStore.getState().isOpen).toBe(true);
    s.togglePanel();
    expect(useAssistantStore.getState().isOpen).toBe(false);
    s.togglePanel();
    expect(useAssistantStore.getState().isOpen).toBe(true);
    s.closePanel();
    expect(useAssistantStore.getState().isOpen).toBe(false);
  });

  it("clearMessages resets conversation but leaves panel state untouched", () => {
    const s = useAssistantStore.getState();
    s.openPanel();
    s.addUserMessage("hi");
    s.setStreaming(true);
    s.setError("boom");
    s.clearMessages();
    const after = useAssistantStore.getState();
    expect(after.messages).toHaveLength(0);
    expect(after.isStreaming).toBe(false);
    expect(after.error).toBeNull();
    expect(after.currentAssistantContent).toBe("");
    // Panel visibility is independent of conversation reset.
    expect(after.isOpen).toBe(true);
  });
});
