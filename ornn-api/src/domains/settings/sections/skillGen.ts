/**
 * Skill-generation section schema (Story 7.3).
 *
 * @module domains/settings/sections/skillGen
 */
import { z } from "zod";
import type { SectionMeta } from "./index";

export const skillGenSchema = z.object({
  defaultProviderId: z.string().nullable(),
  defaultModelId: z.string().nullable(),
  sseKeepAliveMs: z.number().int().min(1000).max(600_000),
});

export type SkillGenSection = z.infer<typeof skillGenSchema>;

export const skillGenDefaults: SkillGenSection = {
  defaultProviderId: null,
  defaultModelId: null,
  sseKeepAliveMs: 15_000,
};

export const skillGenSection: SectionMeta<SkillGenSection> = {
  id: "skillGen",
  publicPath: "skill-generation",
  schema: skillGenSchema,
  secretFields: [],
  defaults: skillGenDefaults,
};
