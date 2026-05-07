/**
 * Skill audit section schema (Story 7.7). Replaces the old
 * `auditWaiverThreshold` knob with `riskThreshold` plus LLM /
 * AgentSeal toggles.
 *
 * @module domains/settings/sections/skillAudit
 */
import { z } from "zod";
import type { SectionMeta } from "./index";

export const skillAuditSchema = z
  .object({
    llmAuditEnabled: z.boolean(),
    llmAuditDefaultProviderId: z.string().nullable(),
    llmAuditDefaultModelId: z.string().nullable(),
    riskThreshold: z.number().min(0).max(10),
    agentSealEnabled: z.boolean(),
    agentSealTimeoutMs: z.number().int().min(1000).max(600_000),
  })
  .superRefine((value, ctx) => {
    if (value.llmAuditEnabled && !value.llmAuditDefaultProviderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["llmAuditDefaultProviderId"],
        message: "required when llmAuditEnabled is true",
      });
    }
  });

export type SkillAuditSection = z.infer<typeof skillAuditSchema>;

export const skillAuditDefaults: SkillAuditSection = {
  llmAuditEnabled: false,
  llmAuditDefaultProviderId: null,
  llmAuditDefaultModelId: null,
  riskThreshold: 6.0,
  agentSealEnabled: true,
  agentSealTimeoutMs: 60_000,
};

export const skillAuditSection: SectionMeta<SkillAuditSection> = {
  id: "skillAudit",
  publicPath: "skill-audit",
  schema: skillAuditSchema,
  secretFields: [],
  defaults: skillAuditDefaults,
};
