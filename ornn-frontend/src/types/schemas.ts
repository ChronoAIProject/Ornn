import { z } from "zod";

export const skillCreateSchema = z
  .object({
    name: z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(100)
      .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
    description: z
      .string()
      .min(10, "Description must be at least 10 characters")
      .max(500),
    category: z.enum(["plain", "tool-based", "runtime-based", "mixed"]),
    tags: z
      .array(z.string().max(30))
      .min(1, "At least one tag required")
      .max(10),
    license: z.string().max(50).optional(),
    tools: z.array(z.string().max(50)).optional(),
    runtimes: z.array(z.string().max(50)).optional(),
    readmeMd: z.string().max(50000).optional(),
  })
  .refine(
    (data) => {
      if (data.category === "tool-based" || data.category === "mixed") {
        return data.tools && data.tools.length > 0;
      }
      return true;
    },
    {
      message: "Tools are required for tool-based and mixed skills",
      path: ["tools"],
    },
  )
  .refine(
    (data) => {
      if (data.category === "runtime-based" || data.category === "mixed") {
        return data.runtimes && data.runtimes.length > 0;
      }
      return true;
    },
    {
      message: "Runtimes are required for runtime-based and mixed skills",
      path: ["runtimes"],
    },
  );

export const skillUpdateSchema = z.object({
  description: z.string().min(1).max(1000).optional(),
  category: z.string().min(1).max(50).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  license: z.string().max(50).optional(),
  repoUrl: z.string().url().optional().or(z.literal("")),
});

export const versionCreateSchema = z.object({
  version: z.string().regex(/^\d+$/, "Version must be a number (e.g. 1, 2, 3)"),
  readmeMd: z.string().max(50000).optional(),
});

export type SkillCreateInput = z.infer<typeof skillCreateSchema>;
export type SkillUpdateInput = z.infer<typeof skillUpdateSchema>;
export type VersionCreateInput = z.infer<typeof versionCreateSchema>;
