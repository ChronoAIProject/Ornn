/**
 * GitHub mirror section schema.
 *
 * `appPrivateKey` is encrypted at rest by the SettingsService before it
 * lands in Mongo. It is exposed mid-masked on GET and replaced with a
 * redaction sentinel on settings export.
 *
 * `reconcileSchedule` is a cron expression interpreted in
 * `Asia/Singapore` (UTC+8, no DST — see
 * `domains/skills/mirror/scheduler.ts`). Empty string disables the
 * scheduled reconcile entirely (publish-time webhooks still fire).
 * Default `0 2 * * *` = daily at 02:00 SGT.
 *
 * @module domains/settings/sections/mirror
 */
import { z } from "zod";
import { CronExpressionParser } from "cron-parser";
import type { SectionMeta } from "./index";

/**
 * Validates that the input is either an empty string (disabled) or a
 * cron expression accepted by `cron-parser`. We do NOT require a
 * 5-field UNIX cron specifically — `cron-parser` also accepts 6-field
 * forms with seconds; either is fine for our purposes.
 */
const cronSchedule = z
  .string()
  .refine(
    (s) => {
      if (s.length === 0) return true;
      try {
        CronExpressionParser.parse(s);
        return true;
      } catch {
        // Intentional silent (#579): the false return becomes a Zod
        // validation error with the message below — that's the
        // user-facing signal. Logging the cron-parser exception would
        // be noisy on every form-validation typo.
        return false;
      }
    },
    { message: "must be a valid cron expression or empty (disabled)" },
  );

export const mirrorSchema = z.object({
  enabled: z.boolean(),
  owner: z.string(),
  repo: z.string(),
  branch: z.string(),
  appId: z.string(),
  installationId: z.string(),
  appPrivateKey: z.string(),
  reconcileSchedule: cronSchedule,
});

export type MirrorSection = z.infer<typeof mirrorSchema>;

export const mirrorDefaults: MirrorSection = {
  enabled: false,
  owner: "",
  repo: "",
  branch: "",
  appId: "",
  installationId: "",
  appPrivateKey: "",
  // Daily at 02:00 SGT (UTC+8). Schedule is applied by the in-process
  // scheduler with `timezone: "Asia/Singapore"` so this reads literally
  // as 2am Singapore time.
  reconcileSchedule: "0 2 * * *",
};

export const mirrorSection: SectionMeta<MirrorSection> = {
  id: "mirror",
  publicPath: "mirror",
  schema: mirrorSchema,
  secretFields: ["appPrivateKey"],
  defaults: mirrorDefaults,
};
