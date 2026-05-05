/**
 * PostHogProvider — single mount point for analytics lifecycle.
 *
 * Responsibilities:
 *   - Initialize the PostHog SDK (idempotent, no-ops when not configured).
 *   - Subscribe to the auth store and call `identify` whenever the
 *     current user changes; call `reset` on logout.
 *   - Track page transitions through React Router so SPA navigation is
 *     captured even though the page never reloads. PostHog has its own
 *     auto-pageview, but it relies on `pushState` events; subscribing to
 *     RR's location changes is the most reliable path.
 *
 * No DOM output — the consent banner lives in `CookieConsentBanner`.
 *
 * @module components/analytics/PostHogProvider
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import posthog from "posthog-js";
import { initAnalytics, identify, reset } from "@/lib/analytics";
import { useAuthStore, isAdmin } from "@/stores/authStore";
import { config } from "@/config";

export function PostHogProvider() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  const lastIdentifiedRef = useRef<string | null>(null);

  // One-shot init on mount.
  useEffect(() => {
    initAnalytics();
  }, []);

  // Identify-on-auth. Re-runs whenever the persisted user changes —
  // covers fresh login (OAuthCallbackPage), tab-restore from
  // localStorage, and post-refresh token swaps.
  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      // Drop the prior identity when the session ends so the next
      // anonymous distinct id isn't tied to the previous user.
      if (lastIdentifiedRef.current) {
        reset();
        lastIdentifiedRef.current = null;
      }
      return;
    }
    if (lastIdentifiedRef.current === user.id) return;
    identify(user.id, {
      email: user.email,
      displayName: user.displayName,
      isAdmin: isAdmin(user),
      // signupAt is exposed via the backend /me endpoint; the JWT
      // doesn't carry it. We surface it as a trait when present so the
      // PostHog "first seen" cohort matches Ornn's view of signup time.
    });
    lastIdentifiedRef.current = user.id;
  }, [isAuthenticated, user]);

  // SPA pageview capture. PostHog's `capture_pageview: true` only fires
  // on full page loads; React Router uses pushState and doesn't trigger
  // a navigation event. Manually capture on every location change.
  useEffect(() => {
    if (!config.posthogApiKey || !config.posthogHost) return;
    try {
      posthog.capture("$pageview", {
        $current_url: window.location.href,
        path: location.pathname,
      });
    } catch {
      /* ignore — wrapper logs init failures already */
    }
  }, [location.pathname, location.search]);

  return null;
}
