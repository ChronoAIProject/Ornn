/**
 * Quota defaults section schema (Story 7.9 / 1.2).
 *
 * @module domains/settings/sections/quotaDefaults
 */
import { z } from "zod";
import type { SectionMeta } from "./index";

export const quotaDefaultsSchema = z.object({
  defaultPlaygroundMonthly: z.number().int().min(0).max(1_000_000),
  defaultSkillGenMonthly: z.number().int().min(0).max(1_000_000),
});

export type QuotaDefaultsSection = z.infer<typeof quotaDefaultsSchema>;

export const quotaDefaultsDefaults: QuotaDefaultsSection = {
  defaultPlaygroundMonthly: 200,
  defaultSkillGenMonthly: 20,
};

export const quotaDefaultsSection: SectionMeta<QuotaDefaultsSection> = {
  id: "quotaDefaults",
  publicPath: "quota",
  schema: quotaDefaultsSchema,
  secretFields: [],
  defaults: quotaDefaultsDefaults,
};
