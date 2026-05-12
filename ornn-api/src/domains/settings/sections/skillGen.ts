/**
 * Skill-generation section schema (Story 7.3).
 *
 * Owns:
 *   - Default LLM provider + model (the picker seed for new users)
 *   - SSE keep-alive cadence for the generation stream
 *   - Default monthly quota for non-admin users (#302 — was a separate
 *     `quotaDefaults` section, folded in here so each surface owns its
 *     own knob)
 *
 * @module domains/settings/sections/skillGen
 */
import { z } from "zod";
import type { SectionMeta } from "./index";

export const skillGenSchema = z.object({
  defaultProviderId: z.string().nullable(),
  defaultModelId: z.string().nullable(),
  sseKeepAliveMs: z.number().int().min(1000).max(600_000),
  defaultMonthlyQuota: z.number().int().min(0).max(1_000_000),
});

export type SkillGenSection = z.infer<typeof skillGenSchema>;

export const skillGenDefaults: SkillGenSection = {
  defaultProviderId: null,
  defaultModelId: null,
  sseKeepAliveMs: 15_000,
  defaultMonthlyQuota: 20,
};

export const skillGenSection: SectionMeta<SkillGenSection> = {
  id: "skillGen",
  publicPath: "skill-generation",
  schema: skillGenSchema,
  secretFields: [],
  defaults: skillGenDefaults,
};
