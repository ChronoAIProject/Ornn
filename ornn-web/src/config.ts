/**
 * Runtime configuration reader.
 *
 * Values are injected into `window.__ORNN_CONFIG__` at container startup
 * by `/docker-entrypoint.d/40-envsubst-config-js.sh`, which envsubst's
 * `public/config.js.template` into `/config.js`. `index.html` loads that
 * script before the main bundle.
 *
 * For `bun run dev` / Vitest, `window.__ORNN_CONFIG__` is either empty
 * (dev stub at `public/config.js`) or unset; values fall back to
 * `import.meta.env.VITE_*` so `.env.local` keeps working.
 *
 * @module config
 */

export interface OrnnConfig {
  apiBaseUrl: string;
  nyxidOauthAuthorizeUrl: string;
  nyxidOauthTokenUrl: string;
  nyxidOauthClientId: string;
  nyxidOauthRedirectUri: string;
  nyxidLogoutUrl: string;
  nyxidSettingsUrl: string;
  /**
   * NyxID frontend link coords (#275). The SPA composes
   * `${nyxidBaseFrontendUrl}${nyxidMy*Path}` for in-app links to NyxID's
   * own pages. Empty path values mean "no link"; empty base URL disables
   * all four. These used to live in the `nyxid` admin-settings section
   * and moved here because they have no server-side consumer.
   */
  nyxidBaseFrontendUrl: string;
  nyxidMyServicesPath: string;
  nyxidMyProfilePath: string;
  nyxidMyOrganizationPath: string;
  /** PostHog public project key (`phc_…`). Empty disables analytics. */
  posthogApiKey: string;
  /** PostHog project id — informational, surfaced in logs only. */
  posthogProjectId: string;
  /** PostHog ingest host (e.g. https://eu.i.posthog.com). Empty disables analytics. */
  posthogHost: string;
}

declare global {
  interface Window {
    __ORNN_CONFIG__?: Partial<OrnnConfig>;
  }
}

const runtime =
  typeof window !== "undefined" && window.__ORNN_CONFIG__
    ? window.__ORNN_CONFIG__
    : {};

export const config: OrnnConfig = {
  apiBaseUrl: runtime.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "",
  nyxidOauthAuthorizeUrl:
    runtime.nyxidOauthAuthorizeUrl ??
    import.meta.env.VITE_NYXID_OAUTH_AUTHORIZE_URL ??
    "",
  nyxidOauthTokenUrl:
    runtime.nyxidOauthTokenUrl ??
    import.meta.env.VITE_NYXID_OAUTH_TOKEN_URL ??
    "",
  nyxidOauthClientId:
    runtime.nyxidOauthClientId ??
    import.meta.env.VITE_NYXID_OAUTH_CLIENT_ID ??
    "",
  nyxidOauthRedirectUri:
    runtime.nyxidOauthRedirectUri ??
    import.meta.env.VITE_NYXID_OAUTH_REDIRECT_URI ??
    "",
  nyxidLogoutUrl:
    runtime.nyxidLogoutUrl ?? import.meta.env.VITE_NYXID_LOGOUT_URL ?? "",
  nyxidSettingsUrl:
    runtime.nyxidSettingsUrl ??
    import.meta.env.VITE_NYXID_SETTINGS_URL ??
    "",
  nyxidBaseFrontendUrl:
    runtime.nyxidBaseFrontendUrl ??
    import.meta.env.VITE_NYXID_BASE_FRONTEND_URL ??
    "",
  nyxidMyServicesPath:
    runtime.nyxidMyServicesPath ??
    import.meta.env.VITE_NYXID_MY_SERVICES_PATH ??
    "",
  nyxidMyProfilePath:
    runtime.nyxidMyProfilePath ??
    import.meta.env.VITE_NYXID_MY_PROFILE_PATH ??
    "",
  nyxidMyOrganizationPath:
    runtime.nyxidMyOrganizationPath ??
    import.meta.env.VITE_NYXID_MY_ORGANIZATION_PATH ??
    "",
  posthogApiKey:
    runtime.posthogApiKey ?? import.meta.env.VITE_POSTHOG_API_KEY ?? "",
  posthogProjectId:
    runtime.posthogProjectId ?? import.meta.env.VITE_POSTHOG_PROJECT_ID ?? "",
  posthogHost:
    runtime.posthogHost ?? import.meta.env.VITE_POSTHOG_HOST ?? "",
};
