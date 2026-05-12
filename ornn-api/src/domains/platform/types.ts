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
   * Full GitHub mirror config — kill switch, repo coords, App credentials.
   * The MirrorService reads this on every operation; an admin patch via
   * the admin UI takes effect on the next sync without a redeploy.
   *
   * `appPrivateKey` is encrypted at rest (AES-256-GCM via `infra/crypto`,
   * scrypt-derived from `ENCRYPTION_KEY`); the routes layer mid-masks it
   * on read so the operator can sanity-check which key is in place
   * without exposing the body.
   */
  readonly githubMirror: GithubMirrorConfig;
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
 * Full GitHub mirror config. Operator-flippable end-to-end via the admin
 * UI; no env / configmap fallback — empty fields mean "not configured"
 * and the MirrorService no-ops.
 */
export interface GithubMirrorConfig {
  /** Master kill switch. When false, every mirror op is a no-op. */
  readonly enabled: boolean;
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  /** GitHub App numeric id (visible on the App settings page). */
  readonly appId: string;
  /** Installation id for `<owner>/<repo>` (org-wide installation). */
  readonly installationId: string;
  /**
   * RSA private key in PEM format. Encrypted at rest; the routes layer
   * mid-masks it on read. Empty string = "no key set".
   */
  readonly appPrivateKey: string;
}

/**
 * Sentinel default. Returned by `PlatformSettingsService.get()` when the
 * DB row is missing fields — empty strings + `enabled: false` so a
 * fresh deployment with no admin-set settings has the mirror cleanly
 * disabled until an operator flips it on via the UI.
 */
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  auditWaiverThreshold: 6.0,
  githubMirror: {
    enabled: false,
    owner: "",
    repo: "",
    branch: "",
    appId: "",
    installationId: "",
    appPrivateKey: "",
  },
  llmProvider: {
    gatewayUrl: "",
    apiKey: "",
  },
};
