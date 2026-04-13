import { z } from "zod";

/**
 * Schema for the unified skill search endpoint query params.
 */
export const skillSearchQuerySchema = z.object({
  query: z.string().max(2000).optional().default(""),
  mode: z.enum(["keyword", "similarity"]).optional().default("keyword"),
  scope: z.enum(["public", "private", "mixed"]).optional().default("private"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(9),
});

export type SkillSearchQueryInput = z.infer<typeof skillSearchQuerySchema>;

/** Schema for direct generation requests (generative mode). */
export const generateQuerySchema = z.object({
  query: z.string().min(1, "Description is required").max(2000),
});

export type GenerateQueryInput = z.infer<typeof generateQuerySchema>;
