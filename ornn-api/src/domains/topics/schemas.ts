/**
 * Zod schemas for the topics API.
 *
 * Topic names share the skill-name regex: kebab-case, 1–64 chars, starting
 * with a letter or digit. Names are immutable once created — `update` only
 * touches description / isPrivate.
 *
 * @module domains/topics/schemas
 */

import { z } from "zod";

export const TOPIC_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export const topicCreateSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(TOPIC_NAME_REGEX, "Topic name must be kebab-case (lowercase alphanumeric + hyphens)"),
  description: z.string().max(2048).optional().default(""),
  isPrivate: z.boolean().optional().default(false),
  /**
   * Optional org user_id. When present, the topic is owned by that org —
   * the route verifies the caller is an admin/member of the org before
   * threading it into the service.
   */
  targetOrgId: z.string().min(1).max(128).optional(),
});

export const topicUpdateSchema = z
  .object({
    description: z.string().max(2048).optional(),
    isPrivate: z.boolean().optional(),
  })
  .refine(
    (data) => data.description !== undefined || data.isPrivate !== undefined,
    { message: "At least one of description / isPrivate must be provided" },
  );

export const topicAddSkillsSchema = z.object({
  skillIds: z.array(z.string().min(1)).min(1).max(100),
});

export type TopicCreateInput = z.infer<typeof topicCreateSchema>;
export type TopicUpdateInput = z.infer<typeof topicUpdateSchema>;
export type TopicAddSkillsInput = z.infer<typeof topicAddSkillsSchema>;
