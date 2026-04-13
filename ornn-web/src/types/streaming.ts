/** SSE event types for the direct generation endpoint (generative mode) */
export type GenerationStreamEvent =
  | { type: "generation_start" }
  | { type: "token"; content: string }
  | { type: "generation_complete"; raw: string }
  | { type: "validation_error"; message: string; retrying: boolean }
  | { type: "error"; message: string };

/** Phase state machine for generative mode streaming */
export type GenerationStreamPhase =
  | "idle"
  | "generating"
  | "complete"
  | "error";
