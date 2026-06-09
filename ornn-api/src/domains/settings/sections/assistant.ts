/**
 * Ornn Assistant section schema (#970).
 *
 * The Assistant is the third LLM surface (after `playground` and
 * `skillGen`). It powers the repo-aware Q&A chatbot — a pure,
 * non-agentic completion grounded in a curated knowledge base plus a
 * visibility-scoped skill retrieval. This section owns the same knobs
 * every LLM surface owns so the resolver / quota / SSE machinery can
 * treat it uniformly:
 *
 *   - Default LLM provider + model (picker seed + execute-path fallback)
 *   - SSE keep-alive cadence for the streaming chat
 *   - Default monthly quota for non-admin users
 *
 * Mirrors `playground.ts` / `skillGen.ts` field-for-field so a new
 * surface is purely additive: one section schema + one `getXxx()`
 * accessor + the per-model surface flags. No other surface's behaviour
 * changes.
 *
 * @module domains/settings/sections/assistant
 */
import { z } from "zod";
import type { SectionMeta } from "./index";

export const assistantSchema = z.object({
  defaultProviderId: z.string().nullable(),
  defaultModelId: z.string().nullable(),
  sseKeepAliveMs: z.number().int().min(1000).max(600_000),
  defaultMonthlyQuota: z.number().int().min(0).max(1_000_000),
});

export type AssistantSection = z.infer<typeof assistantSchema>;

export const assistantDefaults: AssistantSection = {
  defaultProviderId: null,
  defaultModelId: null,
  sseKeepAliveMs: 15_000,
  // Q&A turns are cheaper + more frequent than skill generation but the
  // surface is still LLM-billed; seed a middle-ground monthly allotment.
  defaultMonthlyQuota: 100,
};

export const assistantSection: SectionMeta<AssistantSection> = {
  id: "assistant",
  publicPath: "assistant",
  schema: assistantSchema,
  secretFields: [],
  defaults: assistantDefaults,
};
