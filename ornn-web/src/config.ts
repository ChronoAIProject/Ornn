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
  nyxidAuthorizeUrl: string;
  nyxidTokenUrl: string;
  nyxidClientId: string;
  nyxidRedirectUri: string;
  nyxidLogoutUrl: string;
  nyxidSettingsUrl: string;
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
  nyxidAuthorizeUrl:
    runtime.nyxidAuthorizeUrl ??
    import.meta.env.VITE_NYXID_AUTHORIZE_URL ??
    "",
  nyxidTokenUrl:
    runtime.nyxidTokenUrl ?? import.meta.env.VITE_NYXID_TOKEN_URL ?? "",
  nyxidClientId:
    runtime.nyxidClientId ?? import.meta.env.VITE_NYXID_CLIENT_ID ?? "",
  nyxidRedirectUri:
    runtime.nyxidRedirectUri ??
    import.meta.env.VITE_NYXID_REDIRECT_URI ??
    "",
  nyxidLogoutUrl:
    runtime.nyxidLogoutUrl ?? import.meta.env.VITE_NYXID_LOGOUT_URL ?? "",
  nyxidSettingsUrl:
    runtime.nyxidSettingsUrl ??
    import.meta.env.VITE_NYXID_SETTINGS_URL ??
    "",
};
