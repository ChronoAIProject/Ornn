/**
 * Telemetry section — PostHog runtime config.
 *
 * Edited via `/admin/settings/telemetry` and read at boot by
 * `bootstrap.ts` so the admin can change PostHog targeting without
 * touching env vars. Env vars stay as the bootstrap fallback (and as
 * the seed for the very first read on a fresh DB).
 *
 * Restart-required: changes apply on the next ornn-api container
 * restart. The admin UI surfaces this explicitly.
 *
 * `postHogApiKey` is encrypted at rest via `secretFields` (the
 * settings layer ciphers it with the cluster `ENCRYPTION_KEY` and
 * redacts on read for non-admin export targets).
 *
 * OpenTelemetry fields previously lived here as a placeholder; they
 * were dropped in issue #271 — Ornn does not run any OTel pipeline.
 *
 * @module domains/settings/sections/telemetry
 */
import { z } from "zod";
import { PUBLIC_URL_REFUSAL, requirePublicUrl } from "../../../infra/url";
import type { SectionMeta } from "./index";

const optionalHttpUrl = z.string().refine(requirePublicUrl, {
  message: PUBLIC_URL_REFUSAL,
});

export const telemetrySchema = z.object({
  /** Master switch. When false the backend uses a NoopTracker regardless of key. */
  postHogEnabled: z.boolean(),
  /** PostHog project API key (the public `phc_…` key). Empty disables. */
  postHogApiKey: z.string(),
  /** Ingest host (e.g. `https://eu.i.posthog.com`). Empty falls back to env. */
  postHogHost: optionalHttpUrl,
  /** Informational only — surfaces in log lines for debug correlation. */
  postHogProjectId: z.string(),
  /** Sub-sampling rate for `api.error` 5xx events, in [0, 1]. */
  postHogErrorSampleRate: z.number().min(0).max(1),
});

export type TelemetrySection = z.infer<typeof telemetrySchema>;

export const telemetryDefaults: TelemetrySection = {
  postHogEnabled: false,
  postHogApiKey: "",
  postHogHost: "",
  postHogProjectId: "",
  postHogErrorSampleRate: 0.1,
};

export const telemetrySection: SectionMeta<TelemetrySection> = {
  id: "telemetry",
  // Public URL renamed from "telemetry" to "posthog" (#302) — the section
  // only carries PostHog config, so the more specific name reads better
  // in /admin/settings. Section id stays "telemetry" so existing Mongo
  // rows keep their _id and the operator doesn't lose their saved state.
  publicPath: "posthog",
  schema: telemetrySchema,
  secretFields: ["postHogApiKey"],
  defaults: telemetryDefaults,
};
