/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the ornn-skill API backend. */
  readonly VITE_API_BASE_URL: string;

  /** NyxID OAuth authorize endpoint URL. */
  readonly VITE_NYXID_AUTHORIZE_URL: string;
  /** NyxID OAuth token endpoint URL. */
  readonly VITE_NYXID_TOKEN_URL: string;
  /** NyxID OAuth client ID. */
  readonly VITE_NYXID_CLIENT_ID: string;
  /** NyxID OAuth redirect URI (this app's callback URL). */
  readonly VITE_NYXID_REDIRECT_URI: string;
  /** NyxID logout endpoint URL. */
  readonly VITE_NYXID_LOGOUT_URL: string;
  /** NyxID settings/profile page URL (for linking from Settings page). */
  readonly VITE_NYXID_SETTINGS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
