/**
 * Frontend type definitions for the Playground feature.
 * Simplified for Nyx Provider - no more user LLM config management.
 * @module types/playground
 */

// ---------------------------------------------------------------------------
// Available Models (via Nyx Provider)
// ---------------------------------------------------------------------------

/**
 * Common models available through Nyx Provider.
 * Users configure their LLM credentials in NyxID, not ornn.
 */
export const AVAILABLE_MODELS = [
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", provider: "Chrono LLM" },
] as const;

export type AvailableModelId = (typeof AVAILABLE_MODELS)[number]["id"];

export const DEFAULT_MODEL: AvailableModelId = "gpt-5.3-codex";

// ---------------------------------------------------------------------------
// Credential Types (no encrypted values on frontend)
// ---------------------------------------------------------------------------

export interface PlaygroundCredential {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Chat Types (Responses API format)
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ToolCallStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "error";

export interface PlaygroundMessage {
  /** Stable unique identifier for React reconciliation. */
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

export interface FileOutput {
  path: string;
  content: string; // base64
  size: number;
  mimeType: string;
}

export type PlaygroundChatEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "tool-result"; toolCallId: string; result: string }
  | { type: "file-output"; file: FileOutput }
  | { type: "error"; message: string }
  | { type: "finish"; finishReason: string };

/** Valid event type strings for type guards. */
export const PLAYGROUND_EVENT_TYPES = new Set([
  "text-delta",
  "tool-call",
  "tool-result",
  "file-output",
  "error",
  "finish",
]);
