/**
 * Authentication state management using Zustand.
 * NyxID OAuth flow with JWT token management.
 * @module stores/authStore
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser, NyxIDTokenResponse, NyxIDJwtClaims, NyxIDIdTokenClaims } from "@/types/auth";
import { config } from "@/config";
import { createLogger } from "@/lib/logger";

const logger = createLogger("auth");

/** Refresh token 1 minute before expiry. */
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

/** Consider token expired if less than 30s remaining (for proactive refresh). */
const TOKEN_EXPIRY_THRESHOLD_MS = 30 * 1000;

/** NyxID OAuth configuration from runtime config. */
const NYXID_CONFIG = {
  authorizeUrl: config.nyxidOauthAuthorizeUrl,
  tokenUrl: config.nyxidOauthTokenUrl,
  clientId: config.nyxidOauthClientId,
  redirectUri: config.nyxidOauthRedirectUri,
  logoutUrl: config.nyxidLogoutUrl,
};

interface AuthState {
  accessToken: string | null;
  refreshTokenValue: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  tokenExpiresAt: number | null;
  _refreshTimerId: ReturnType<typeof setTimeout> | null;
  /**
   * In-flight token-refresh promise (#631). When non-null, the SPA has
   * an `/oauth/token` `refresh_token` request pending; concurrent
   * callers (a near-expiry preflight in `apiClient.fetchWithRetry`, a
   * 401-triggered retry in the same client, the scheduled
   * `startTokenRefresh` timer, and the `visibilitychange` handler can
   * all race within the same millisecond) MUST await this promise
   * instead of firing their own. NyxID rotates the refresh token on
   * every successful exchange, so a second concurrent request loses
   * the race and gets:
   *
   *   `Conflict: Refresh token was concurrently rotated, please retry`
   *
   * which then surfaces as a logout-loop. Promises aren't
   * serialisable, so this field is deliberately excluded from
   * `partialize` — it only lives for the lifetime of the tab.
   */
  _refreshInFlight: Promise<void> | null;

  loginWithNyxID(): Promise<void>;
  handleNyxIDCallback(code: string): Promise<void>;
  refreshToken(): Promise<void>;
  logout(): void;
  initialize(): void;
  ensureFreshToken(): Promise<void>;
  startTokenRefresh(): void;
  stopTokenRefresh(): void;
}

/**
 * Decode JWT payload without verification (frontend use only).
 * Actual verification happens on the backend.
 */
function decodeJwtPayload(token: string): NyxIDJwtClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // Length-checked above. `!` is safe under noUncheckedIndexedAccess
    // (#450).
    const payload = atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload) as NyxIDJwtClaims;
  } catch {
    logger.error("Failed to decode JWT payload");
    return null;
  }
}

/**
 * Extract user info from NyxID access token claims + optional ID token claims.
 * ID token carries profile info (email, name, picture); access token carries RBAC.
 */
function extractUserFromClaims(
  accessClaims: NyxIDJwtClaims,
  idClaims?: NyxIDIdTokenClaims | null,
): AuthUser {
  const email = idClaims?.email ?? "";
  const name = idClaims?.name ?? "";
  return {
    id: accessClaims.sub,
    email,
    displayName: name || email || accessClaims.sub,
    avatarUrl: idClaims?.picture ?? "",
    roles: accessClaims.roles ?? [],
    permissions: accessClaims.permissions ?? [],
  };
}

/**
 * Whether the resolved user object is missing display-grade profile
 * info (email or human-readable name). Specifically: empty fields, or
 * the bug-prone case where `displayName` fell back to the NyxID
 * GUID because the OAuth id_token didn't carry email/name. The user-
 * menu and PostHog identify both rely on these, so we re-pull from
 * `/api/v1/me` whenever this is true.
 */
function needsProfileBackfill(user: AuthUser | null): boolean {
  if (!user) return false;
  if (!user.email) return true;
  if (!user.displayName) return true;
  if (user.displayName === user.id) return true;
  return false;
}

/**
 * Pull `email` / `displayName` / `roles` / `permissions` from
 * `/api/v1/me` and merge into the persisted user. Used both at
 * login time (when id_token is light) and on rehydrate (when a
 * previous Safari session persisted a UUID-as-displayName).
 *
 * Idempotent: keeps existing displayName if it's already a real
 * name (anything other than the NyxID GUID). Failure is logged
 * and swallowed — UI keeps the UUID rather than crash.
 */
async function backfillProfileFromMe(
  set: (
    partial:
      | Partial<AuthState>
      | ((state: AuthState) => Partial<AuthState>),
  ) => void,
): Promise<void> {
  try {
    const { fetchMe } = await import("@/services/meApi");
    const me = await fetchMe();
    if (!me) return;
    set((prev) => ({
      user: prev.user
        ? {
            ...prev.user,
            email: prev.user.email || me.email,
            displayName:
              prev.user.displayName && prev.user.displayName !== prev.user.id
                ? prev.user.displayName
                : me.displayName || me.email || prev.user.id,
            roles: prev.user.roles?.length ? prev.user.roles : me.roles,
            permissions: prev.user.permissions?.length
              ? prev.user.permissions
              : me.permissions,
          }
        : prev.user,
    }));
  } catch (err) {
    logger.error("Me backfill failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Generate a random state parameter for CSRF protection.
 */
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate PKCE code_verifier and code_challenge (S256).
 */
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshTokenValue: null,
      user: null,
      isAuthenticated: false,
      isInitialized: false,
      isLoading: false,
      tokenExpiresAt: null,
      _refreshTimerId: null,
      _refreshInFlight: null,

      loginWithNyxID: async () => {
        logger.info("Initiating NyxID OAuth login with PKCE");
        const state = generateState();
        sessionStorage.setItem("nyxid_oauth_state", state);

        const { verifier, challenge } = await generatePKCE();
        sessionStorage.setItem("nyxid_pkce_verifier", verifier);

        const params = new URLSearchParams({
          response_type: "code",
          client_id: NYXID_CONFIG.clientId,
          redirect_uri: NYXID_CONFIG.redirectUri,
          scope: "openid profile email roles proxy",
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
        });

        window.location.href = `${NYXID_CONFIG.authorizeUrl}?${params}`;
      },

      handleNyxIDCallback: async (code: string) => {
        logger.info("Handling NyxID OAuth callback");
        set({ isLoading: true });

        try {
          const codeVerifier = sessionStorage.getItem("nyxid_pkce_verifier") ?? "";
          sessionStorage.removeItem("nyxid_pkce_verifier");

          const response = await fetch(NYXID_CONFIG.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              client_id: NYXID_CONFIG.clientId,
              redirect_uri: NYXID_CONFIG.redirectUri,
              code_verifier: codeVerifier,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Token exchange failed: ${errorText}`);
          }

          const tokenResponse = (await response.json()) as NyxIDTokenResponse;
          const accessClaims = decodeJwtPayload(tokenResponse.access_token) as NyxIDJwtClaims | null;
          if (!accessClaims) {
            throw new Error("Failed to decode access token");
          }

          // Decode ID token for user profile (email, name, picture)
          const idClaims = tokenResponse.id_token
            ? (decodeJwtPayload(tokenResponse.id_token) as unknown as NyxIDIdTokenClaims | null)
            : null;

          const user = extractUserFromClaims(accessClaims, idClaims);
          const expiresAt = accessClaims.exp * 1000;

          logger.info("NyxID OAuth login successful", { userId: user.id, email: user.email });

          set({
            accessToken: tokenResponse.access_token,
            refreshTokenValue: tokenResponse.refresh_token,
            user,
            isAuthenticated: true,
            isLoading: false,
            isInitialized: true,
            tokenExpiresAt: expiresAt,
          });

          get().startTokenRefresh();

          // Back-fill from Ornn's /api/v1/me when the OAuth id_token
          // shipped without email / name claims (happens for
          // admin-created NyxID users). Fire-and-forget; we don't
          // block the login path on it.
          if (needsProfileBackfill(user)) {
            void backfillProfileFromMe(set);
          }
        } catch (err) {
          logger.error("NyxID OAuth callback failed", {
            error: err instanceof Error ? err.message : String(err),
          });
          set({
            accessToken: null,
            refreshTokenValue: null,
            user: null,
            isAuthenticated: false,
            isLoading: false,
            isInitialized: true,
            tokenExpiresAt: null,
          });
          throw err;
        }
      },

      refreshToken: async () => {
        // #631 — dedup concurrent callers. The SPA fans out into
        // `refreshToken()` from up to four places within the same
        // millisecond (`apiClient.fetchWithRetry` proactive +
        // reactive-on-401, the scheduled `startTokenRefresh` timer,
        // and the `visibilitychange` handler). NyxID rotates the
        // refresh token on every successful exchange, so a second
        // concurrent caller wins the rotation while the loser sees
        //   `Conflict: Refresh token was concurrently rotated`
        // and the SPA logs the user out. Funnel all callers through
        // a single in-flight promise.
        const existing = get()._refreshInFlight;
        if (existing) {
          logger.debug("Token refresh already in flight — awaiting existing promise");
          return existing;
        }

        const refreshTokenValue = get().refreshTokenValue;
        if (!refreshTokenValue) {
          logger.info("No refresh token available, clearing auth");
          get().logout();
          return;
        }

        logger.info("Refreshing NyxID access token");

        const promise = (async () => {
          try {
            const response = await fetch(NYXID_CONFIG.tokenUrl, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshTokenValue,
                client_id: NYXID_CONFIG.clientId,
              }),
            });

            if (!response.ok) {
              throw new Error(`Token refresh failed: ${response.status}`);
            }

            const tokenResponse = (await response.json()) as NyxIDTokenResponse;
            const accessClaims = decodeJwtPayload(tokenResponse.access_token) as NyxIDJwtClaims | null;
            if (!accessClaims) {
              throw new Error("Failed to decode refreshed access token");
            }

            // Preserve profile info from initial login; keep existing roles/permissions if refreshed token lacks them
            const existingUser = get().user;
            const user: AuthUser = {
              id: accessClaims.sub,
              email: existingUser?.email ?? "",
              displayName: existingUser?.displayName ?? accessClaims.sub,
              avatarUrl: existingUser?.avatarUrl ?? "",
              roles: accessClaims.roles?.length ? accessClaims.roles : (existingUser?.roles ?? []),
              permissions: accessClaims.permissions?.length ? accessClaims.permissions : (existingUser?.permissions ?? []),
            };
            const expiresAt = accessClaims.exp * 1000;

            logger.info("Token refresh successful");

            set({
              accessToken: tokenResponse.access_token,
              refreshTokenValue: tokenResponse.refresh_token ?? refreshTokenValue,
              user,
              isAuthenticated: true,
              tokenExpiresAt: expiresAt,
            });

            get().startTokenRefresh();
          } catch (err) {
            logger.error("Token refresh failed", {
              error: err instanceof Error ? err.message : String(err),
            });
            get().stopTokenRefresh();
            set({
              accessToken: null,
              refreshTokenValue: null,
              user: null,
              isAuthenticated: false,
              tokenExpiresAt: null,
            });
          }
        })();
        // Stash so concurrent callers latch on. The finally clears
        // the slot once the request settles — the NEXT (later in
        // time) `refreshToken()` call then starts fresh.
        set({ _refreshInFlight: promise });
        try {
          await promise;
        } finally {
          set({ _refreshInFlight: null });
        }
      },

      logout: () => {
        logger.info("Logging out");
        get().stopTokenRefresh();

        set({
          accessToken: null,
          refreshTokenValue: null,
          user: null,
          isAuthenticated: false,
          isLoading: false,
          tokenExpiresAt: null,
        });

        // Redirect to login page
        window.location.href = "/login";
      },

      initialize: () => {
        const state = get();
        if (state.isInitialized) return;

        logger.info("Initializing auth state");

        // Check for existing tokens from persisted storage
        if (state.accessToken && state.tokenExpiresAt) {
          const now = Date.now();
          if (state.tokenExpiresAt > now) {
            logger.info("Found valid persisted session");
            set({ isAuthenticated: true, isInitialized: true, isLoading: false });
            get().startTokenRefresh();
            // Self-heal on rehydrate: a previous session may have
            // persisted user.displayName === user.id (UUID fallback)
            // because the original id_token shipped without email/name
            // and the user closed the tab before the initial backfill
            // resolved. Re-pull from /me so the Navbar / PostHog
            // identify see a real name on this and every future tab.
            if (needsProfileBackfill(state.user)) {
              void backfillProfileFromMe(set);
            }
            return;
          }

          // Token expired, try to refresh
          if (state.refreshTokenValue) {
            logger.info("Persisted token expired, attempting refresh");
            set({ isLoading: true });
            get().refreshToken().then(() => {
              set({ isInitialized: true, isLoading: false });
              // After refresh, the user object is reconstructed from
              // the new access token; if it still lacks profile info,
              // backfill (same self-heal as the un-expired path above).
              if (needsProfileBackfill(get().user)) {
                void backfillProfileFromMe(set);
              }
            });
            return;
          }
        }

        // No valid session
        set({
          accessToken: null,
          refreshTokenValue: null,
          user: null,
          isAuthenticated: false,
          isInitialized: true,
          isLoading: false,
          tokenExpiresAt: null,
        });
      },

      /**
       * Proactively refresh the token if it is expired or about to expire.
       * Called before API requests and when the tab regains focus.
       */
      ensureFreshToken: async () => {
        const state = get();
        if (!state.accessToken || !state.tokenExpiresAt) return;

        const remaining = state.tokenExpiresAt - Date.now();
        if (remaining > TOKEN_EXPIRY_THRESHOLD_MS) return;

        logger.info("Token expired or near-expiry, proactively refreshing");
        await state.refreshToken();
      },

      startTokenRefresh: () => {
        const state = get();
        if (state._refreshTimerId) {
          clearTimeout(state._refreshTimerId);
        }

        const expiresAt = state.tokenExpiresAt;
        if (!expiresAt) return;

        const refreshIn = Math.max(0, expiresAt - Date.now() - TOKEN_REFRESH_BUFFER_MS);

        const timerId = setTimeout(() => {
          get().refreshToken();
        }, refreshIn);

        set({ _refreshTimerId: timerId });
      },

      stopTokenRefresh: () => {
        const state = get();
        if (state._refreshTimerId) {
          clearTimeout(state._refreshTimerId);
          set({ _refreshTimerId: null });
        }
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshTokenValue: state.refreshTokenValue,
        user: state.user,
        tokenExpiresAt: state.tokenExpiresAt,
      }),
    },
  ),
);

// ── Auto-initialize on module load ──────────────────────────────────────
// Ensures auth state is restored from localStorage on every page load,
// not only when AuthGuard mounts. This fixes the bug where refreshing
// public pages (/, /docs, /registry) loses the logged-in state.
useAuthStore.getState().initialize();

// ── Refresh token when tab regains focus ────────────────────────────────
// Browsers throttle/skip setTimeout in background tabs. When the user
// comes back after idling, the scheduled refresh may have been missed
// and the access token may have expired.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const state = useAuthStore.getState();
      if (state.isAuthenticated) {
        logger.info("Tab became visible, checking token freshness");
        state.ensureFreshToken();
        // Re-arm the scheduled refresh in case the timer was skipped
        state.startTokenRefresh();
      }
    }
  });
}

/**
 * Hook to get current access token.
 */
export function useAccessToken(): string | null {
  return useAuthStore((state) => state.accessToken);
}

/**
 * Hook to check if user is authenticated.
 */
export function useIsAuthenticated(): boolean {
  return useAuthStore((state) => state.isAuthenticated);
}

/**
 * Hook to get current user.
 */
export function useCurrentUser(): AuthUser | null {
  return useAuthStore((state) => state.user);
}

/**
 * Hook to check if auth is loading.
 */
export function useAuthLoading(): boolean {
  return useAuthStore((state) => state.isLoading);
}

/**
 * Check if user has a specific permission.
 */
export function hasPermission(user: AuthUser | null, permission: string): boolean {
  return user?.permissions?.includes(permission) ?? false;
}

/**
 * Check if user has admin permissions.
 */
export function isAdmin(user: AuthUser | null): boolean {
  return user?.permissions?.some((p) => p.startsWith("ornn:admin:")) ?? false;
}
