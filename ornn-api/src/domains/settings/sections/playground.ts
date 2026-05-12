/**
 * Playground section schema (Story 7.2).
 *
 * Owns:
 *   - Default LLM provider + model (the picker seed for new users)
 *   - SSE keep-alive cadence for streaming chat
 *   - Default monthly quota for non-admin users (#302 — was a separate
 *     `quotaDefaults` section, folded in here so each surface owns its
 *     own knob)
 *
 * @module domains/settings/sections/playground
 */
import { z } from "zod";
import type { SectionMeta } from "./index";

export const playgroundSchema = z.object({
  defaultProviderId: z.string().nullable(),
  defaultModelId: z.string().nullable(),
  sseKeepAliveMs: z.number().int().min(1000).max(600_000),
  defaultMonthlyQuota: z.number().int().min(0).max(1_000_000),
});

export type PlaygroundSection = z.infer<typeof playgroundSchema>;

export const playgroundDefaults: PlaygroundSection = {
  defaultProviderId: null,
  defaultModelId: null,
  sseKeepAliveMs: 15_000,
  defaultMonthlyQuota: 200,
};

export const playgroundSection: SectionMeta<PlaygroundSection> = {
  id: "playground",
  publicPath: "playground",
  schema: playgroundSchema,
  secretFields: [],
  defaults: playgroundDefaults,
};
