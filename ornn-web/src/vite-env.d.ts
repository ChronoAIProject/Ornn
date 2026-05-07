/// <reference types="vite/client" />

/** Injected at build time by Vite from root package.json version. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Ornn API base URL (empty = same-origin via nginx proxy). */
  readonly VITE_ORNN_API_BASE_URL: string;
  /** NyxID API base URL (no trailing slash). */
  readonly VITE_NYXID_API_BASE_URL: string;
  /** NyxID web/frontend base URL (no trailing slash). */
  readonly VITE_NYXID_WEB_BASE_URL: string;

  /** NyxID OAuth authorize path (appended to VITE_NYXID_WEB_BASE_URL). */
  readonly VITE_NYXID_OAUTH_AUTHORIZE_PATH: string;
  /** NyxID OAuth token path (appended to VITE_NYXID_API_BASE_URL). */
  readonly VITE_NYXID_OAUTH_TOKEN_PATH: string;
  /** NyxID OAuth redirect path (appended to window.location.origin). */
  readonly VITE_NYXID_OAUTH_REDIRECT_PATH: string;
  /** NyxID logout path (appended to VITE_NYXID_WEB_BASE_URL). */
  readonly VITE_NYXID_LOGOUT_PATH: string;
  /** NyxID settings/profile page path (appended to VITE_NYXID_WEB_BASE_URL). */
  readonly VITE_NYXID_SETTINGS_PATH: string;

  /** NyxID OAuth client ID (public / PKCE client). */
  readonly VITE_NYXID_OAUTH_CLIENT_ID: string;

  readonly VITE_POSTHOG_API_KEY: string;
  readonly VITE_POSTHOG_PROJECT_ID: string;
  readonly VITE_POSTHOG_HOST: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
