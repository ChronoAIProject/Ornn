/**
 * Zustand store for playground chat state.
 * Manages messages, streaming state, and tool call approval flow.
 * Session-only (no persist) -- conversation resets on page reload.
 * @module stores/playgroundStore
 */

import { create } from "zustand";
import type {
  PlaygroundMessage,
  ToolCall,
  ToolCallStatus,
  AvailableModelId,
  FileOutput,
} from "@/types/playground";
import { DEFAULT_MODEL } from "@/types/playground";

/** Monotonically increasing counter for stable message IDs. */
let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `msg-${messageIdCounter}`;
}

interface PlaygroundState {
  /** Full conversation history. */
  messages: PlaygroundMessage[];
  /** Whether the AI is currently streaming a response. */
  isStreaming: boolean;
  /** Status of each tool call by ID. */
  toolCallStatuses: Record<string, ToolCallStatus>;
  /** File outputs from sandbox execution. */
  fileOutputs: FileOutput[];
  /** Current error message. */
  error: string | null;
  /** Buffer for current assistant message being streamed. */
  currentAssistantContent: string;
  /** Currently selected model for chat. */
  selectedModel: AvailableModelId;

  // Actions
  setSelectedModel: (model: AvailableModelId) => void;
  addUserMessage: (content: string) => void;
  startAssistantMessage: () => void;
  appendAssistantDelta: (delta: string) => void;
  finalizeAssistantMessage: () => void;
  addToolCall: (toolCall: ToolCall) => void;
  addToolResult: (toolCallId: string, result: string) => void;
  addFileOutput: (file: FileOutput) => void;
  updateToolCallStatus: (toolCallId: string, status: ToolCallStatus) => void;
  setStreaming: (isStreaming: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
}

export const usePlaygroundStore = create<PlaygroundState>((set, get) => ({
  messages: [],
  isStreaming: false,
  toolCallStatuses: {},
  fileOutputs: [],
  error: null,
  currentAssistantContent: "",
  selectedModel: DEFAULT_MODEL,

  setSelectedModel: (model) => set({ selectedModel: model }),

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

  addToolCall: (toolCall) => {
    // All tool calls are auto-executed server-side, no HITL approval needed
    set((state) => ({
      toolCallStatuses: {
        ...state.toolCallStatuses,
        [toolCall.id]: "executing",
      },
    }));

    // Attach tool call to the last assistant message or create a new one
    set((state) => {
      const msgs = [...state.messages];
      const lastMsg = msgs[msgs.length - 1];

      if (lastMsg?.role === "assistant") {
        lastMsg.toolCalls = [...(lastMsg.toolCalls ?? []), toolCall];
      } else {
        msgs.push({
          id: nextMessageId(),
          role: "assistant",
          content: state.currentAssistantContent || "",
          toolCalls: [toolCall],
        });
        return { messages: msgs, currentAssistantContent: "" };
      }
      return { messages: msgs };
    });
  },

  addToolResult: (toolCallId, result) => {
    set((state) => ({
      messages: [
        ...state.messages,
        { id: nextMessageId(), role: "tool", content: result, toolCallId },
      ],
      toolCallStatuses: {
        ...state.toolCallStatuses,
        [toolCallId]: "completed",
      },
    }));
  },

  addFileOutput: (file) => {
    set((state) => ({ fileOutputs: [...state.fileOutputs, file] }));
  },

  updateToolCallStatus: (toolCallId, status) => {
    set((state) => ({
      toolCallStatuses: {
        ...state.toolCallStatuses,
        [toolCallId]: status,
      },
    }));
  },

  setStreaming: (isStreaming) => set({ isStreaming }),
  setError: (error) => set({ error }),

  clearMessages: () =>
    set({
      messages: [],
      isStreaming: false,
      toolCallStatuses: {},
      fileOutputs: [],
      error: null,
      currentAssistantContent: "",
    }),
}));
