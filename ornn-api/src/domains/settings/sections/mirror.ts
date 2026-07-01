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
import { OWNER_RE, REPO_RE } from "../../../shared/githubNaming";
import { cronSchedule } from "./cronSchedule";
import type { SectionMeta } from "./index";

export const mirrorSchema = z.object({
  enabled: z.boolean(),
  owner: z.string().refine((v) => v === "" || OWNER_RE.test(v), {
    message: "must be a valid GitHub owner or empty",
  }),
  repo: z.string().refine((v) => v === "" || REPO_RE.test(v), {
    message: "must be a valid GitHub repo name or empty",
  }),
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
