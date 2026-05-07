/**
 * Environment variable configuration for ornn-api (bootstrap-only).
 *
 * Per the Architecture §7 inventory, runtime-flippable knobs (LLM gateway,
 * default model, storage/sandbox URLs, NyxID base URL/paths, AgentSeal
 * toggle/timeout, SSE keep-alive, extra NyxID services, **PostHog
 * telemetry**) live in admin settings (`platform_settings` collection)
 * and are read on demand via `SettingsService`. `loadConfig` only resolves
 * what's needed to bring the process up: DB URI, log level, NyxID SA
 * credentials (so the very first settings read can authenticate downstream
 * proxies if required), the encryption key for at-rest secrets, CORS
 * origins, and the public origin used for canonical-link generation.
 *
 * PostHog values stay in env as a *bootstrap fallback* for the very first
 * boot (when the DB telemetry section is empty / defaults). Once the
 * admin saves a value through Settings → Telemetry, that DB value wins
 * on the next restart.
 *
 * Validation is schema-driven via Zod. Library code throws `ConfigError`
 * on invalid env; the entry point (`src/index.ts`) decides what to do
 * with the failure (typically: log and exit 1).
 *
 * @module infra/config
 */

import { z } from "zod";

export interface SkillConfig {
  // Service
  readonly port: number;
  readonly logLevel: string;
  readonly logPretty: boolean;

  // NyxID — service-account credentials only (URLs come from settings).
  readonly nyxidTokenUrl: string;
  readonly nyxidClientId: string;
  readonly nyxidClientSecret: string;

  // MongoDB
  readonly mongodbUri: string;
  readonly mongodbDb: string;

  // Skill package upload limit (image-baked operational constant).
  readonly maxPackageSizeBytes: number;

  // CORS
  /**
   * Allow-listed origins for cross-origin requests with credentials.
   * Parsed from the comma-separated `ALLOWED_ORIGINS` env var. An empty
   * list denies all cross-origin requests (same-origin still works).
   */
  readonly allowedOrigins: readonly string[];

  // PostHog (server-side product analytics) — bootstrap fallback only.
  // Live values are read from the `telemetry` settings section at boot
  // (issue #271). When the section is empty, we fall back to these.
  readonly posthogEnabled: boolean;
  readonly posthogApiKey: string | null;
  readonly posthogProjectId: string | null;
  readonly posthogHost: string;
  readonly posthogErrorSampleRate: number;

  // AgentSeal — scanner binary paths (image-baked); enabled-flag and
  // timeout move to settings (skillAudit section).
  readonly agentsealPython: string;
  readonly agentsealScript: string;

  /**
   * Origin used in mirror READMEs to link back to the canonical Ornn
   * page (`<origin>/skills/<name>`). E.g. `https://ornn.chrono-ai.fun`.
   * No-trailing-slash, validated.
   */
  readonly ornnPublicOrigin: string;

  /**
   * Master passphrase for AES-256-GCM at-rest secret encryption (LLM
   * provider apiKey, future operator-pasted secrets). Falls back to a
   * dev sentinel when `ENCRYPTION_KEY` is unset — production deployments
   * MUST override.
   */
  readonly encryptionKey: string;
}

/** Parses "true"/"false"/"1"/"0" into a real boolean. */
const booleanFromEnv = z
  .string()
  .default("false")
  .transform((v) => {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3802),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  LOG_PRETTY: booleanFromEnv,

  NYXID_SA_TOKEN_URL: z.string().url(),
  NYXID_SA_CLIENT_ID: z.string().min(1),
  NYXID_SA_CLIENT_SECRET: z.string().min(1),

  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default("ornn"),

  MAX_PACKAGE_SIZE_BYTES: z.coerce.number().int().positive().default(52428800),

  /**
   * Comma-separated list of origins permitted for cross-origin requests
   * with credentials. Empty = deny all (same-origin only). Example:
   *   ALLOWED_ORIGINS=https://app.ornn.xyz,http://localhost:5173
   */
  ALLOWED_ORIGINS: z.string().default(""),

  /**
   * Master passphrase for the at-rest secret cipher (AES-256-GCM via
   * scrypt-derived key). MUST be ≥ 32 chars — schema rejects shorter
   * values at boot. There is NO dev fallback: a missing or weak key
   * fails-fast with a structured `ConfigError` rather than silently
   * encrypting every operator-pasted secret with a publicly-known
   * passphrase. Tests that boot the harness set `ENCRYPTION_KEY`
   * themselves (engineer-2's harness already does this).
   */
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters (set via env in all environments — no dev fallback)"),

  // ---- PostHog (server-side product analytics) — bootstrap fallback. ----
  // Admin Settings → Telemetry overrides these at boot when set.
  POSTHOG_ENABLED: booleanFromEnv,
  POSTHOG_API_KEY: z.string().default(""),
  POSTHOG_PROJECT_ID: z.string().default(""),
  POSTHOG_HOST: z.string().url().default("https://eu.i.posthog.com"),
  POSTHOG_ERROR_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // ---- AgentSeal (skill trust scanner, #253) — binary paths only ----
  AGENTSEAL_PYTHON: z.string().min(1).default("/opt/agentseal/bin/python"),
  AGENTSEAL_SCRIPT: z.string().min(1).default("/opt/agentseal/scan_skill.py"),

  /**
   * Public origin agents and humans use to reach Ornn (no trailing
   * slash). Only used by the mirror service today, but generally
   * useful for any link generation. Default works for local dev.
   *
   * Coerce empty string → undefined so a `.env` line that's commented
   * out (envsubst injects literal "") still falls through to the
   * default instead of failing `.url()` validation at boot.
   */
  ORNN_PUBLIC_ORIGIN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().default("https://ornn.chrono-ai.fun"),
  ),
});

/**
 * Thrown when env parsing fails. Caller decides how to surface the
 * failure (log + exit, throw upward, etc.). The message enumerates
 * every missing or invalid var so operators don't have to retry.
 */
export class ConfigError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    const summary = issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    super(`Invalid configuration: ${summary}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function loadConfig(): SkillConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    throw new ConfigError(result.error.issues);
  }
  const env = result.data;

  return {
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,

    nyxidTokenUrl: env.NYXID_SA_TOKEN_URL,
    nyxidClientId: env.NYXID_SA_CLIENT_ID,
    nyxidClientSecret: env.NYXID_SA_CLIENT_SECRET,

    mongodbUri: env.MONGODB_URI,
    mongodbDb: env.MONGODB_DB,

    maxPackageSizeBytes: env.MAX_PACKAGE_SIZE_BYTES,

    allowedOrigins: env.ALLOWED_ORIGINS
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),

    // Schema enforces ≥32 chars; trim is just defensive against trailing
    // whitespace from `.env` files. A short/missing key already failed
    // safeParse above, so we never reach here without a real value.
    encryptionKey: env.ENCRYPTION_KEY.trim(),

    posthogEnabled: env.POSTHOG_ENABLED,
    posthogApiKey: env.POSTHOG_API_KEY.trim() ? env.POSTHOG_API_KEY.trim() : null,
    posthogProjectId: env.POSTHOG_PROJECT_ID.trim() ? env.POSTHOG_PROJECT_ID.trim() : null,
    posthogHost: env.POSTHOG_HOST,
    posthogErrorSampleRate: env.POSTHOG_ERROR_SAMPLE_RATE,

    agentsealPython: env.AGENTSEAL_PYTHON,
    agentsealScript: env.AGENTSEAL_SCRIPT,

    ornnPublicOrigin: env.ORNN_PUBLIC_ORIGIN.replace(/\/+$/, ""),
  };
}
