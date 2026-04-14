/**
 * Activity logging API.
 * Logs user login/logout events to the backend.
 * @module services/activityApi
 */

import { useAuthStore } from "@/stores/authStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

const logger = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(`[activityApi] ${msg}`, data ?? ""),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(`[activityApi] ${msg}`, data ?? ""),
};

/**
 * Log a user activity (login or logout).
 * Fire-and-forget — errors are caught and logged, never thrown.
 */
export async function logActivity(action: "login" | "logout"): Promise<void> {
  try {
    const { accessToken, user } = useAuthStore.getState();
    if (!accessToken) {
      logger.warn("No access token, skipping activity log", { action });
      return;
    }

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    if (user?.email) {
      headers["X-User-Email"] = user.email;
    }
    if (user?.displayName) {
      headers["X-User-Display-Name"] = user.displayName;
    }

    const res = await fetch(`${API_BASE}/api/activity/${action}`, {
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
