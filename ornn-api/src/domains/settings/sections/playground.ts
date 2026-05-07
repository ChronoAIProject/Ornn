/**
 * Playground section schema (Story 7.2).
 *
 * @module domains/settings/sections/playground
 */
import { z } from "zod";
import type { SectionMeta } from "./index";

export const playgroundSchema = z.object({
  defaultProviderId: z.string().nullable(),
  defaultModelId: z.string().nullable(),
  sseKeepAliveMs: z.number().int().min(1000).max(600_000),
});

export type PlaygroundSection = z.infer<typeof playgroundSchema>;

export const playgroundDefaults: PlaygroundSection = {
  defaultProviderId: null,
  defaultModelId: null,
  sseKeepAliveMs: 15_000,
};

export const playgroundSection: SectionMeta<PlaygroundSection> = {
  id: "playground",
  publicPath: "playground",
  schema: playgroundSchema,
  secretFields: [],
  defaults: playgroundDefaults,
};
