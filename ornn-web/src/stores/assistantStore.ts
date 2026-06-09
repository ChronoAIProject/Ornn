/**
 * Zustand store for the Ornn Assistant chat (#970).
 *
 * Manages the conversation, streaming state, the live answer buffer, and
 * the widget's open/closed state. Session-only (NO persist) — the
 * conversation and panel state reset on page reload, exactly like
 * `playgroundStore`. The assistant is a transient helper, not a saved
 * thread.
 *
 * @module stores/assistantStore
 */

import { create } from "zustand";
import type { AssistantMessage } from "@/types/assistant";

/** Monotonically increasing counter for stable message IDs. */
let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `assistant-msg-${messageIdCounter}`;
}

interface AssistantState {
  /** Whether the slide-in chat panel is open. */
  isOpen: boolean;
  /** Full conversation history (user + assistant turns). */
  messages: AssistantMessage[];
  /** Whether the assistant is currently streaming a reply. */
  isStreaming: boolean;
  /** Current error message, or null. */
  error: string | null;
  /** Buffer for the assistant turn currently being streamed. */
  currentAssistantContent: string;

  // Actions — panel
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  // Actions — conversation
  addUserMessage: (content: string) => void;
  startAssistantMessage: () => void;
  appendAssistantDelta: (delta: string) => void;
  finalizeAssistantMessage: () => void;
  setStreaming: (isStreaming: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  isOpen: false,
  messages: [],
  isStreaming: false,
  error: null,
  currentAssistantContent: "",

  openPanel: () => set({ isOpen: true }),
  closePanel: () => set({ isOpen: false }),
  togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),

  addUserMessage: (content) => {
    set((state) => ({
      messages: [...state.messages, { id: nextMessageId(), role: "user", content }],
      error: null,
    }));
  },

  startAssistantMessage: () => {
    set({ currentAssistantContent: "" });
  },

  appendAssistantDelta: (delta) => {
    set((state) => ({
      currentAssistantContent: state.currentAssistantContent + delta,
    }));
  },

  finalizeAssistantMessage: () => {
    const content = get().currentAssistantContent;
    if (content) {
      set((state) => ({
        messages: [...state.messages, { id: nextMessageId(), role: "assistant", content }],
        currentAssistantContent: "",
      }));
    }
  },

  setStreaming: (isStreaming) => set({ isStreaming }),
  setError: (error) => set({ error }),

  clearMessages: () =>
    set({
      messages: [],
      isStreaming: false,
      error: null,
      currentAssistantContent: "",
    }),
}));
