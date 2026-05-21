/**
 * Activity logging API.
 * Logs user login/logout events to the backend.
 * @module services/activityApi
 */

import { useAuthStore } from "@/stores/authStore";
import { config } from "@/config";
import { createLogger } from "@/lib/logger";

const API_BASE = config.apiBaseUrl;
const logger = createLogger("activityApi");

/**
 * Log a user activity (login or logout).
 * Fire-and-forget — errors are caught and logged, never thrown.
 */
export async function logActivity(action: "login" | "logout"): Promise<void> {
  try {
    const { accessToken } = useAuthStore.getState();
    if (!accessToken) {
      logger.warn("No access token, skipping activity log", { action });
      return;
    }

    // #528 — `X-User-Email` / `X-User-Display-Name` used to ride along
    // here. They were stripped by the NyxID proxy and never read by
    // the backend (identity is sourced from the proxy-forwarded
    // identity token), but the backend CORS allowlist doesn't include
    // them — sending them tripped a preflight-blocked-by-CORS failure
    // on every login. Same dead code as the `apiClient.createHeaders`
    // cleanup; this caller was missed in the original sweep.
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };

    const res = await fetch(`${API_BASE}/api/v1/activity/${action}`, {
      method: "POST",
      headers,
      credentials: "include",
    });

    if (!res.ok) {
      logger.warn(`Failed to log ${action} activity`, { status: res.status });
    } else {
      logger.info(`Logged ${action} activity`);
    }
  } catch (err) {
    logger.warn(`Error logging ${action} activity`, { error: String(err) });
  }
}
