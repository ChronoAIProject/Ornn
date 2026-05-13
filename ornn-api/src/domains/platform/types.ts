/**
 * Platform-wide settings. One singleton document, admin-editable, cached
 * in-memory with a short TTL so the permission path can read the current
 * threshold cheaply.
 *
 * Everything operator-flippable lives here — kill switches, repo
 * coordinates, sensitive credentials. The pod's only env-side
 * dependencies are bootstrap secrets (Mongo URI, NyxID SA, encryption
 * passphrase). No configmap.
 *
 * @module domains/platform/types
 */

export interface PlatformSettings {
  /**
   * Audit overall score (0–10) at or above which a new grant is auto-
   * applied without a waiver. Scores below this trigger the audit-gated
   * share request flow (owner justification → reviewer decision).
   */
  readonly auditWaiverThreshold: number;
  /**
   * LLM provider override. Empty fields fall back to env (the
   * Chrono LLM gateway via NyxID SA token exchange). When `gatewayUrl`
   * is set, every playground / skill-gen LLM call hits that endpoint
   * instead. When `apiKey` is set, calls authenticate with that bearer
   * token instead of the SA token-exchange flow — useful for pointing
   * at OpenAI / Anthropic / a self-hosted proxy directly.
   *
   * Resolved on every LLM call (no pod restart needed), but cached for
   * the same TTL the rest of platform settings use.
   */
  readonly llmProvider: LlmProviderConfig;
}

export interface LlmProviderConfig {
  /** LLM gateway base URL. Empty string = use env `NYX_LLM_GATEWAY_URL`. */
  readonly gatewayUrl: string;
  /**
   * Direct bearer API key. Empty string = use NyxID SA token-exchange
   * flow against env credentials. Stored in MongoDB encrypted; the GET
   * response mid-masks it (first 4 + last 4 chars, bullets in middle).
   */
  readonly apiKey: string;
}

/**
 * Sentinel default. Returned by `PlatformSettingsService.get()` when the
 * DB row is missing fields — empty strings so a fresh deployment with
 * no admin-set settings boots cleanly.
 *
 * Mirror config has moved to `SettingsService.getMirror()`
 * (`platform_settings:{_id:"mirror"}`); the legacy `githubMirror` field
 * on this PlatformSettings doc was dropped in #437 after a one-shot
 * boot migration copied any existing values into the new section.
 */
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  auditWaiverThreshold: 6.0,
  llmProvider: {
    gatewayUrl: "",
    apiKey: "",
  },
};
