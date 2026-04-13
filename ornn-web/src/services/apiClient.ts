/**
 * HTTP API client with NyxID authentication.
 * All requests go to the single ornn-api backend.
 * Handles automatic token refresh on 401 errors.
 * @module services/apiClient
 */

import type { ApiResponse } from "@/types/api";
import { useAuthStore } from "@/stores/authStore";

const logger = {
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(`[apiClient] ${msg}`, data ?? ""),
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

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

  const user = useAuthStore.getState().user;
  if (user?.email) {
    headers["X-User-Email"] = user.email;
  }
  if (user?.displayName) {
    headers["X-User-Display-Name"] = user.displayName;
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

  const json = (await response.json()) as ApiResponse<T>;

  if (!response.ok || json.error) {
    throw new ApiClientError(
      json.error?.code ?? "UNKNOWN_ERROR",
      json.error?.message ?? "An unexpected error occurred",
      response.status,
    );
  }

  return json;
}

/**
 * Execute fetch with proactive token refresh and automatic retry on 401/403.
 */
async function fetchWithRetry<T>(
  url: string,
  options: RequestInit,
  retried: boolean = false,
): Promise<ApiResponse<T>> {
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

  // Handle 401/403 — attempt refresh if user was authenticated and not already retried
  if ((response.status === 401 || response.status === 403) && !retried) {
    const hadToken = !!getAccessToken();

    if (hadToken) {
      const refreshSuccess = await attemptTokenRefresh();

      if (refreshSuccess) {
        const newHeaders = {
          ...options.headers,
          Authorization: `Bearer ${getAccessToken()}`,
        };

        return fetchWithRetry<T>(url, { ...options, headers: newHeaders }, true);
      }

      // Refresh failed for an authenticated user, redirect to login
      logger.error("Token refresh failed, redirecting to login");
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
    // Anonymous user got 401 — don't redirect, just let the error propagate
  }

  return handleResponse<T>(response);
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
 */
export async function apiDelete(path: string): Promise<void> {
  // Proactively refresh expired tokens before sending
  if (getAccessToken()) {
    await useAuthStore.getState().ensureFreshToken();
  }

  const response = await fetch(buildUrl(path), {
    method: "DELETE",
    headers: createHeaders(),
  });

  // Handle 401/403
  if (response.status === 401 || response.status === 403) {
    const refreshSuccess = await attemptTokenRefresh();

    if (refreshSuccess) {
      const retryResponse = await fetch(buildUrl(path), {
        method: "DELETE",
        headers: createHeaders(),
      });

      if (!retryResponse.ok) {
        const json = await retryResponse.json().catch(() => null);
        throw new ApiClientError(
          (json as ApiResponse<unknown>)?.error?.code ?? "DELETE_FAILED",
          (json as ApiResponse<unknown>)?.error?.message ?? "Delete failed",
          retryResponse.status,
        );
      }
      return;
    }

    logger.error("Token refresh failed during DELETE, redirecting to login");
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new ApiClientError(
      (json as ApiResponse<unknown>)?.error?.code ?? "DELETE_FAILED",
      (json as ApiResponse<unknown>)?.error?.message ?? "Delete failed",
      response.status,
    );
  }
}

export { ApiClientError as ApiError };
