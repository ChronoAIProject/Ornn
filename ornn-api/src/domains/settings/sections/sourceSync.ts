/**
 * GitHub source-sync section schema.
 *
 * Controls the automatic sync of GitHub-sourced skills — the poller that
 * detects when a linked upstream repo has moved and (later phases) re-pulls
 * it. This section (#1175) only carries the config; the scheduler (#1176)
 * and auto-publish (#1177) consume it.
 *
 * `githubToken` is a service-account GitHub token used ONLY to authenticate
 * reads of **public** repos so drift checks escape the unauthenticated
 * 60-req/hr-per-IP ceiling (authenticated is 5,000/hr with free `304`s). It
 * grants no access the public web doesn't already have — it exists purely to
 * lift the rate limit. It is encrypted at rest by the SettingsService (like
 * `mirror.appPrivateKey`), mid-masked on GET, and redacted on export. When
 * empty here, the runtime falls back to the `ORNN_SOURCE_SYNC_GITHUB_TOKEN`
 * env var; when both are empty the poller runs unauthenticated (rate-limited).
 *
 * `pollSchedule` is a cron expression interpreted in `Asia/Singapore`
 * (matching the mirror scheduler). Empty string disables the schedule.
 *
 * @module domains/settings/sections/sourceSync
 */
import { z } from "zod";
import { cronSchedule } from "./cronSchedule";
import type { SectionMeta } from "./index";

export const sourceSyncSchema = z.object({
  /** Master switch — when false the poller (#1176) does nothing. */
  enabled: z.boolean(),
  /**
   * Service-account GitHub token (fine-grained/classic, public-read).
   * Encrypted at rest + masked. Empty ⇒ fall back to env, then to
   * unauthenticated reads.
   */
  githubToken: z.string(),
  /** Cron for the drift poll; "" disables. Interpreted Asia/Singapore. */
  pollSchedule: cronSchedule,
  /** A skill is not re-checked more often than this many minutes. */
  minCheckIntervalMinutes: z.number().int().min(1),
  /**
   * Full unattended auto-publish switch. Consumed by #1177 — when true,
   * detected drift auto-publishes a new version. Default false so the
   * foundation ships inert.
   */
  autoPublish: z.boolean(),
});

export type SourceSyncSection = z.infer<typeof sourceSyncSchema>;

export const sourceSyncDefaults: SourceSyncSection = {
  enabled: false,
  githubToken: "",
  // Every 15 minutes. Applied by the (future) source-sync scheduler with
  // `timezone: "Asia/Singapore"`, matching the mirror scheduler.
  pollSchedule: "*/15 * * * *",
  minCheckIntervalMinutes: 60,
  autoPublish: false,
};

export const sourceSyncSection: SectionMeta<SourceSyncSection> = {
  id: "sourceSync",
  publicPath: "sourceSync",
  schema: sourceSyncSchema,
  secretFields: ["githubToken"],
  defaults: sourceSyncDefaults,
};
