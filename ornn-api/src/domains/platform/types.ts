/**
 * Platform-wide settings. One singleton document, admin-editable, cached
 * in-memory with a short TTL so the permission path can read the current
 * threshold cheaply.
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
   * GitHub mirror repo coordinates. Sourced from the configmap at boot
   * (`GITHUB_MIRROR_REPO_OWNER` / `_REPO_NAME` / `_DEFAULT_BRANCH`) and
   * surfaced here so admins can re-point the mirror at runtime via the
   * admin UI without a redeploy. The configmap is the *seed*; once an
   * admin patches via the API the DB value wins thereafter.
   *
   * The kill switch (`GITHUB_MIRROR_ENABLED`) deliberately stays in the
   * configmap — flipping it is an ops decision that should leave a k8s
   * trail, not a one-click in the admin UI.
   */
  readonly githubMirror: GithubMirrorRepoConfig;
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
   * flow against env credentials. Stored in MongoDB, redacted from the
   * GET response (the API only echoes whether it's set).
   */
  readonly apiKey: string;
}

/**
 * The three fields that point the mirror at a specific GitHub repo.
 * No `enabled` flag here — that lives in the configmap by design (see
 * `PlatformSettings.githubMirror` doc above).
 */
export interface GithubMirrorRepoConfig {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
}

/**
 * Sentinel default. Never read directly — `PlatformSettingsService` is
 * constructed with configmap-derived defaults that override these. The
 * empty strings here exist so `PlatformSettings` can be fully populated
 * even before the service has been wired (e.g. unit tests on the repo).
 */
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  auditWaiverThreshold: 6.0,
  githubMirror: {
    owner: "",
    repo: "",
    branch: "",
  },
  llmProvider: {
    gatewayUrl: "",
    apiKey: "",
  },
};
