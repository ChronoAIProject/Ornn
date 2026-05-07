/**
 * Runtime configuration reader.
 *
 * Values are injected into `window.__ORNN_CONFIG__` at container startup
 * by `/docker-entrypoint.d/40-envsubst-config-js.sh`, which envsubst's
 * `public/config.js.template` into `/config.js`. `index.html` loads that
 * script before the main bundle.
 *
 * The template surfaces three base URLs (NyxID API, NyxID web, ornn-api)
 * plus a small set of paths. This module composes the full URLs the rest
 * of the SPA consumes, so feature code never has to concatenate base+path
 * itself or pull stunts like stripping `/oauth/authorize` off an authorize
 * URL to recover the API base.
 *
 * For `bun run dev` / Vitest, `window.__ORNN_CONFIG__` is either empty
 * (dev stub at `public/config.js`) or unset; raw values fall back to
 * `import.meta.env.VITE_*` so `.env.local` keeps working.
 *
 * @module config
 */

export interface OrnnConfig {
  /** Ornn API base URL — empty string means same-origin via nginx proxy. */
  apiBaseUrl: string;

  /** Raw NyxID API base URL (no trailing slash). */
  nyxidApiBaseUrl: string;
  /** Raw NyxID web/frontend base URL (no trailing slash). */
  nyxidWebBaseUrl: string;

  /** Composed: nyxidWebBaseUrl + NYXID_OAUTH_AUTHORIZE_PATH. */
  nyxidOauthAuthorizeUrl: string;
  /** Composed: nyxidApiBaseUrl + NYXID_OAUTH_TOKEN_PATH. */
  nyxidOauthTokenUrl: string;
  /** Composed: window.location.origin + NYXID_OAUTH_REDIRECT_PATH. */
  nyxidOauthRedirectUri: string;
  /** Composed: nyxidWebBaseUrl + NYXID_LOGOUT_PATH. */
  nyxidLogoutUrl: string;
  /** Composed: nyxidWebBaseUrl + NYXID_SETTINGS_PATH. */
  nyxidSettingsUrl: string;

  /** OAuth public client id (PKCE). */
  nyxidOauthClientId: string;

  /** PostHog public project key (`phc_…`). Empty disables analytics. */
  posthogApiKey: string;
  /** PostHog project id — informational, surfaced in logs only. */
  posthogProjectId: string;
  /** PostHog ingest host (e.g. https://eu.i.posthog.com). Empty disables analytics. */
  posthogHost: string;
}

interface RawConfig {
  ornnApiBaseUrl?: string;
  nyxidApiBaseUrl?: string;
  nyxidWebBaseUrl?: string;
  nyxidOauthAuthorizePath?: string;
  nyxidOauthTokenPath?: string;
  nyxidOauthRedirectPath?: string;
  nyxidLogoutPath?: string;
  nyxidSettingsPath?: string;
  nyxidOauthClientId?: string;
  posthogApiKey?: string;
  posthogProjectId?: string;
  posthogHost?: string;
}

declare global {
  interface Window {
    __ORNN_CONFIG__?: RawConfig;
  }
}

const runtime: RawConfig =
  typeof window !== "undefined" && window.__ORNN_CONFIG__
    ? window.__ORNN_CONFIG__
    : {};

const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");

const ornnApiBaseUrl = stripTrailingSlash(
  runtime.ornnApiBaseUrl ?? import.meta.env.VITE_ORNN_API_BASE_URL ?? "",
);
const nyxidApiBaseUrl = stripTrailingSlash(
  runtime.nyxidApiBaseUrl ?? import.meta.env.VITE_NYXID_API_BASE_URL ?? "",
);
const nyxidWebBaseUrl = stripTrailingSlash(
  runtime.nyxidWebBaseUrl ?? import.meta.env.VITE_NYXID_WEB_BASE_URL ?? "",
);

const authorizePath =
  runtime.nyxidOauthAuthorizePath ??
  import.meta.env.VITE_NYXID_OAUTH_AUTHORIZE_PATH ??
  "";
const tokenPath =
  runtime.nyxidOauthTokenPath ??
  import.meta.env.VITE_NYXID_OAUTH_TOKEN_PATH ??
  "";
const redirectPath =
  runtime.nyxidOauthRedirectPath ??
  import.meta.env.VITE_NYXID_OAUTH_REDIRECT_PATH ??
  "";
const logoutPath =
  runtime.nyxidLogoutPath ?? import.meta.env.VITE_NYXID_LOGOUT_PATH ?? "";
const settingsPath =
  runtime.nyxidSettingsPath ?? import.meta.env.VITE_NYXID_SETTINGS_PATH ?? "";

const compose = (base: string, path: string): string => {
  if (!base || !path) return "";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
};

const composeWithOrigin = (path: string): string => {
  if (!path) return "";
  const origin =
    typeof window !== "undefined" && window.location ? window.location.origin : "";
  if (!origin) return "";
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
};

export const config: OrnnConfig = {
  apiBaseUrl: ornnApiBaseUrl,
  nyxidApiBaseUrl,
  nyxidWebBaseUrl,
  nyxidOauthAuthorizeUrl: compose(nyxidWebBaseUrl, authorizePath),
  nyxidOauthTokenUrl: compose(nyxidApiBaseUrl, tokenPath),
  nyxidOauthRedirectUri: composeWithOrigin(redirectPath),
  nyxidLogoutUrl: compose(nyxidWebBaseUrl, logoutPath),
  nyxidSettingsUrl: compose(nyxidWebBaseUrl, settingsPath),
  nyxidOauthClientId:
    runtime.nyxidOauthClientId ??
    import.meta.env.VITE_NYXID_OAUTH_CLIENT_ID ??
    "",
  posthogApiKey:
    runtime.posthogApiKey ?? import.meta.env.VITE_POSTHOG_API_KEY ?? "",
  posthogProjectId:
    runtime.posthogProjectId ?? import.meta.env.VITE_POSTHOG_PROJECT_ID ?? "",
  posthogHost: runtime.posthogHost ?? import.meta.env.VITE_POSTHOG_HOST ?? "",
};
