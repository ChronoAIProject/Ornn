/**
 * PostHog dashboard deep-link helpers.
 *
 * Translates the PostHog *ingest* host (`<region>.i.posthog.com`) into
 * the matching *dashboard* host (`<region>.posthog.com`). For self-
 * hosted PostHog the same host serves both, so we leave it as-is.
 *
 * When PostHog is not configured (empty host), returns the public
 * marketing site so the link target is never empty / undefined.
 *
 * Issue #271 — the in-Ornn activity feed was replaced with deep-links
 * here.
 *
 * @module lib/postHogLinks
 */

import { config } from "@/config";

/**
 * Base dashboard URL for the configured PostHog instance.
 *
 *   https://eu.i.posthog.com  → https://eu.posthog.com
 *   https://us.i.posthog.com  → https://us.posthog.com
 *   https://posthog.example   → https://posthog.example  (self-host)
 *   ""                        → https://posthog.com      (fallback)
 */
export function postHogDashboardBaseUrl(): string {
  const host = config.posthogHost?.trim().replace(/\/+$/, "");
  if (!host) return "https://posthog.com";
  return host.replace(
    /^(https?:\/\/[^./]+)\.i\.(posthog\.com)$/,
    "$1.$2",
  );
}

/**
 * URL for the PostHog "Activity" (events) explorer for the configured
 * project. PostHog uses a numeric project id in the URL path; if we
 * don't have one configured we drop into the workspace root and let
 * the user pick a project manually.
 */
export function postHogActivityUrl(): string {
  const base = postHogDashboardBaseUrl();
  const projectId = config.posthogProjectId?.trim();
  if (!projectId) return base;
  return `${base}/project/${encodeURIComponent(projectId)}/activity`;
}

/**
 * URL for the PostHog "Insights" (dashboards) home for the configured
 * project. Used as the "view all platform analytics" link from Ornn's
 * admin dashboard.
 */
export function postHogInsightsUrl(): string {
  const base = postHogDashboardBaseUrl();
  const projectId = config.posthogProjectId?.trim();
  if (!projectId) return base;
  return `${base}/project/${encodeURIComponent(projectId)}/insights`;
}

/** True when the admin has configured a PostHog project. */
export function isPostHogConfigured(): boolean {
  return Boolean(config.posthogApiKey && config.posthogHost);
}
