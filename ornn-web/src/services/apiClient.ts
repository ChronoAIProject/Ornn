/**
 * HTTP API client with NyxID authentication.
 * All requests go to the single ornn-api backend.
 * Handles automatic token refresh on 401 errors.
 * @module services/apiClient
 */

import type { ApiResponse } from "@/types/api";
import { useAuthStore } from "@/stores/authStore";
import { config } from "@/config";
import { createLogger } from "@/lib/logger";

const logger = createLogger("apiClient");
const API_BASE = config.apiBaseUrl;

/**
 * Custom error class for API failures.
 */
export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * Flag to prevent multiple simultaneous refresh attempts.
 */
let isRefreshing = false;
let refreshPromise: Promise<void> | null = null;

/**
 * Get current access token from auth store.
 */
function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

/**
 * Attempt to refresh the access token via NyxID.
 */
async function attemptTokenRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) {
    try {
      await refreshPromise;
      return useAuthStore.getState().isAuthenticated;
    } catch {
      return false;
    }
  }

  isRefreshing = true;
  refreshPromise = useAuthStore.getState().refreshToken();

  try {
    await refreshPromise;
    return useAuthStore.getState().isAuthenticated;
  } catch {
    return false;
  } finally {
    isRefreshing = false;
    refreshPromise = null;
  }
}

/**
 * Build URL with query parameters.
 */
function buildUrl(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.toString();
}

/**
 * Create headers with auth token.
 *
 * `X-User-Email` and `X-User-Display-Name` used to ride along here; they
 * were stripped by the NyxID proxy and never read by the backend (identity
 * is sourced from the proxy-forwarded identity token). Dead code removed
 * in the Epic 1 architecture refactor.
 */
function createHeaders(includeAuth: boolean = true): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (includeAuth) {
    const token = getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  return headers;
}

/**
 * Handle API response and throw on error.
 */
async function handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
  if (response.status === 204) {
    return { data: null, error: null };
  }

  const json = (await response.json()) as unknown;

  if (!response.ok) {
    // Two error body shapes are observed on non-2xx responses:
    //
    //   1. RFC 7807 `application/problem+json` (#456) — `{ code, detail,
    //      title, status }` at the body root. Newer endpoints emit this.
    //   2. Legacy `{ data: null, error: { code, message } }` envelope.
    //      Several domain routes (LLM provider sync, settings validation)
    //      still throw via `AppError → buildErrorEnvelope` which keeps
    //      this shape with a non-2xx status, and #694 surfaced that the
    //      frontend was discarding their actionable `error.message`.
    //
    // Try the envelope first because `error.message` is the most
    // actionable when present; fall back to RFC 7807 fields; final
    // fallback is the generic literal.
    const body = (json ?? {}) as {
      code?: string;
      detail?: string;
      title?: string;
      status?: number;
      error?: { code?: string; message?: string };
    };
    const envelopeCode = body.error?.code;
    const envelopeMessage = body.error?.message;
    throw new ApiClientError(
      envelopeCode ?? body.code ?? "unknown_error",
      envelopeMessage ??
        body.detail ??
        body.title ??
        "An unexpected error occurred",
      body.status ?? response.status,
    );
  }

  // Success: legacy `{ data, error: null }` envelope (unchanged).
  const envelope = json as ApiResponse<T>;
  if (envelope?.error) {
    throw new ApiClientError(
      envelope.error.code ?? "unknown_error",
      envelope.error.message ?? "An unexpected error occurred",
      response.status,
    );
  }
  return envelope;
}

/**
 * Execute fetch with proactive token refresh and automatic retry on 401,
 * returning the raw Response. Shared by the JSON (`fetchWithRetry`) and binary
 * (`apiGetBinary`) request paths so the auth / refresh / redirect-to-login
 * logic lives in exactly one place.
 */
async function rawFetchWithRetry(
  url: string,
  options: RequestInit,
  retried: boolean = false,
): Promise<Response> {
  // Proactively refresh expired tokens before sending the request
  if (!retried && getAccessToken()) {
    await useAuthStore.getState().ensureFreshToken();
    // Re-attach the (possibly refreshed) token
    options = {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${getAccessToken()}` },
    };
  }

  const response = await fetch(url, options);

  // Handle 401 — attempt token refresh if the user was authenticated and we haven't retried.
  // 403 means authenticated-but-forbidden: refresh cannot fix that, so we skip it.
  if (response.status === 401 && !retried) {
    const hadToken = !!getAccessToken();

    if (hadToken) {
      const refreshSuccess = await attemptTokenRefresh();

      if (refreshSuccess) {
        const newHeaders = {
          ...options.headers,
          Authorization: `Bearer ${getAccessToken()}`,
        };

        return rawFetchWithRetry(url, { ...options, headers: newHeaders }, true);
      }

      // Refresh failed for an authenticated user, redirect to login
      logger.error("Token refresh failed, redirecting to login");
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
    // Anonymous user got 401 — don't redirect, just let the error propagate
  }

  return response;
}

/**
 * Execute fetch with retry and parse the JSON `{ data, error }` envelope.
 */
async function fetchWithRetry<T>(
  url: string,
  options: RequestInit,
): Promise<ApiResponse<T>> {
  return handleResponse<T>(await rawFetchWithRetry(url, options));
}

/**
 * GET request with auth.
 */
export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<ApiResponse<T>> {
  return fetchWithRetry<T>(buildUrl(path, params), {
    method: "GET",
    headers: createHeaders(),
  });
}

/**
 * GET request returning the raw response bytes (auth + refresh applied), for
 * binary endpoints such as the skill-package download (#1196). Proxies the
 * bytes through ornn-api so clients never fetch the storage backend directly.
 * Throws `ApiClientError` on a non-2xx (parsing the RFC 7807 / envelope body).
 */
export async function apiGetBinary(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<ArrayBuffer> {
  const res = await rawFetchWithRetry(buildUrl(path, params), {
    method: "GET",
    headers: createHeaders(),
  });
  if (!res.ok) {
    // handleResponse always throws for a non-2xx — reuse its error parsing.
    await handleResponse<unknown>(res);
  }
  return res.arrayBuffer();
}

/**
 * POST request with JSON body and auth.
 */
export async function apiPost<T>(
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  return fetchWithRetry<T>(buildUrl(path), {
    method: "POST",
    headers: createHeaders(),
    body: JSON.stringify(body),
  });
}

/**
 * POST request with FormData and auth.
 */
export async function apiPostForm<T>(
  path: string,
  formData: FormData,
): Promise<ApiResponse<T>> {
  const token = getAccessToken();
  const headers: HeadersInit = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return fetchWithRetry<T>(buildUrl(path), {
    method: "POST",
    headers,
    body: formData,
  });
}

/**
 * PUT request with JSON body and auth.
 */
export async function apiPut<T>(
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  return fetchWithRetry<T>(buildUrl(path), {
    method: "PUT",
    headers: createHeaders(),
    body: JSON.stringify(body),
  });
}

/**
 * PATCH request with JSON body and auth.
 */
export async function apiPatch<T>(
  path: string,
  body: unknown,
): Promise<ApiResponse<T>> {
  return fetchWithRetry<T>(buildUrl(path), {
    method: "PATCH",
    headers: createHeaders(),
    body: JSON.stringify(body),
  });
}

/**
 * DELETE request with auth.
 *
 * Routes through `fetchWithRetry` (#578) so the proactive-refresh /
 * 401-retry / redirect-to-login logic stays in one place. The DELETE
 * response is discarded — most ornn-api DELETEs return 204, and the
 * caller only cares about success vs. an `ApiClientError`.
 */
export async function apiDelete(path: string): Promise<void> {
  await fetchWithRetry<unknown>(buildUrl(path), {
    method: "DELETE",
    headers: createHeaders(),
  });
}

export { ApiClientError as ApiError };
