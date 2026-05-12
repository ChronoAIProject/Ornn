/**
 * PostHog analytics wrapper.
 *
 * Centralizes init, identify, capture, opt-in/opt-out so the rest of the
 * app sees one stable surface — `track()`, `identify()`, `reset()` — and
 * never imports `posthog-js` directly. That lets us:
 *
 *   - No-op cleanly when PostHog is not configured (empty `posthogApiKey`
 *     / `posthogHost`), so previews and local dev keep working without a
 *     live project.
 *   - Gate everything on the user's cookie-consent state. No event,
 *     identify call, or session replay reaches PostHog until consent is
 *     granted. Calls before consent are buffered and replayed on grant.
 *   - Give every `track()` call site a typed event-name list so typos are
 *     caught at compile time.
 *
 * Per CLAUDE.md and #252: API keys are runtime-injected via
 * `window.__ORNN_CONFIG__` (see `src/config.ts`) — never hardcoded.
 *
 * @module lib/analytics
 */

import posthog from "posthog-js";
import { config } from "@/config";
import { hasConsent, onConsentChange } from "./cookieConsent";

const logger = {
  info: (msg: string, data?: Record<string, unknown>) =>
    console.log(`[analytics] ${msg}`, data ?? ""),
  warn: (msg: string, data?: Record<string, unknown>) =>
    console.warn(`[analytics] ${msg}`, data ?? ""),
  error: (msg: string, data?: Record<string, unknown>) =>
    console.error(`[analytics] ${msg}`, data ?? ""),
};

/**
 * Strongly-typed event names. Matches the spec in #252 — every call site
 * must reference a name from this union. New events go here first.
 */
export type AnalyticsEvent =
  | "skill.created"
  | "skill.published"
  | "skill.version_published"
  | "playground.run"
  | "playground.run.completed"
  | "playground.run.failed"
  | "skill_gen.started"
  | "skill_gen.completed"
  | "model.selected"
  | "quota.warning_shown"
  | "quota.exhausted"
  | "credits.granted"
  | "signup.completed"
  | "login.completed";

export interface IdentifyTraits {
  email?: string;
  displayName?: string;
  isAdmin?: boolean;
  /** ISO timestamp; treated as the "user created at" trait. */
  signupAt?: string;
}

interface BufferedCall {
  kind: "track" | "identify" | "reset";
  event?: AnalyticsEvent;
  properties?: Record<string, unknown>;
  userId?: string;
  traits?: IdentifyTraits;
}

let initialized = false;
let initStarted = false;
const buffer: BufferedCall[] = [];

/** Whether PostHog is configured at all — empty key/host disables. */
function isConfigured(): boolean {
  return Boolean(config.posthogApiKey && config.posthogHost);
}

/** Whether PostHog should actually emit — configured AND consent granted. */
function shouldEmit(): boolean {
  return initialized && isConfigured() && hasConsent();
}

/**
 * Lazy-init PostHog the first time consent flips to granted (or on app
 * mount if consent was already saved). Calling more than once is a no-op
 * by design — `posthog-js` itself is idempotent on re-init but we keep
 * an extra guard so the buffered-replay logic only fires once.
 */
export function initAnalytics(): void {
  if (initStarted) return;
  if (!isConfigured()) {
    logger.info("PostHog not configured — analytics disabled");
    initStarted = true;
    return;
  }

  initStarted = true;
  try {
    posthog.init(config.posthogApiKey, {
      api_host: config.posthogHost,
      // Auto-pageview is on per #252.
      capture_pageview: true,
      // Honor the browser's Do-Not-Track signal — if the user has DNT on,
      // PostHog opts out of capture before any event fires. Free GDPR/CCPA
      // affinity; complements the cookie banner rather than replacing it.
      respect_dnt: true,
      // Session replay — gated by consent at the wrapper level. PostHog's
      // own opt-in flag mirrors that so the SDK doesn't even start the
      // recorder until we say so.
      disable_session_recording: !hasConsent(),
      session_recording: {
        // Privacy-first defaults: mask every input AND every rendered text
        // node. Skill content, user names, emails, activity feeds are all
        // user-data; we'd rather lose visual fidelity in replays than
        // risk PII leaking to PostHog. PostHog's own no-text idiom is
        // `maskTextSelector: "*"` — it applies the standard mask to every
        // matching element. Opt back in per element with `data-ph-no-mask`
        // (PostHog's allowlist hook) when a piece of UI is public chrome.
        maskAllInputs: true,
        maskTextSelector: "*",
      },
      // Defer personhood until `identify()` runs on login — anonymous
      // distinct IDs are fine for funnel attribution.
      person_profiles: "identified_only",
      // Honor the cookie banner. PostHog's own opt-in is an additional
      // safety belt — `shouldEmit()` is the one we trust day-to-day.
      opt_out_capturing_by_default: !hasConsent(),
      loaded: () => {
        initialized = true;
        flushBuffer();
        logger.info("PostHog initialized", {
          host: config.posthogHost,
          projectId: config.posthogProjectId || "(unset)",
        });
      },
    });
  } catch (err) {
    logger.error("PostHog init failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Re-evaluate consent transitions: on grant we start recording + opt
  // back in; on revoke we stop and reset the distinct id so further
  // captures don't tie back to the previous session.
  onConsentChange((granted) => {
    if (!initialized) return;
    if (granted) {
      try {
        posthog.opt_in_capturing();
        posthog.startSessionRecording();
        flushBuffer();
        logger.info("Consent granted — analytics enabled");
      } catch (err) {
        logger.error("Failed to enable PostHog after consent", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      try {
        posthog.stopSessionRecording();
        posthog.opt_out_capturing();
        posthog.reset();
        logger.info("Consent revoked — analytics disabled");
      } catch (err) {
        logger.error("Failed to disable PostHog after consent revoke", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });
}

/**
 * Replay any track/identify calls that landed before init or before
 * consent was granted. Keeps call sites simple — they don't need to
 * know whether the SDK is ready yet.
 */
function flushBuffer(): void {
  if (!shouldEmit()) return;
  while (buffer.length) {
    const call = buffer.shift()!;
    try {
      switch (call.kind) {
        case "track":
          if (call.event) posthog.capture(call.event, call.properties);
          break;
        case "identify":
          if (call.userId) posthog.identify(call.userId, call.traits);
          break;
        case "reset":
          posthog.reset();
          break;
      }
    } catch (err) {
      logger.error("Buffered call replay failed", {
        kind: call.kind,
        event: call.event,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Capture a typed analytics event. Safe to call before init / before
 * consent — buffered until both are true. Properties are sent as-is;
 * never include raw secrets or full event bodies.
 */
export function track(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
): void {
  if (!isConfigured()) return;
  if (!shouldEmit()) {
    buffer.push({ kind: "track", event, properties });
    return;
  }
  try {
    posthog.capture(event, properties);
    logger.info("event", { event });
  } catch (err) {
    logger.error("capture failed", {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Identify the current user. Idempotent — re-calling with the same id is
 * the supported pattern (e.g. on every auth-store rehydrate). Traits map
 * to PostHog's `$set` properties.
 */
export function identify(userId: string, traits?: IdentifyTraits): void {
  if (!userId || !isConfigured()) return;
  const payload: Record<string, unknown> = {};
  if (traits?.email) payload.email = traits.email;
  if (traits?.displayName) payload.name = traits.displayName;
  if (typeof traits?.isAdmin === "boolean") payload.is_admin = traits.isAdmin;
  if (traits?.signupAt) payload.signup_at = traits.signupAt;

  if (!shouldEmit()) {
    buffer.push({
      kind: "identify",
      userId,
      traits: { ...traits, ...payload },
    });
    return;
  }
  try {
    posthog.identify(userId, payload);
    logger.info("identify", { userId });
  } catch (err) {
    logger.error("identify failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Forget the current user. Called on logout so the next anonymous
 * session doesn't inherit the previous user's distinct id.
 */
export function reset(): void {
  if (!isConfigured()) return;
  if (!shouldEmit()) {
    buffer.push({ kind: "reset" });
    return;
  }
  try {
    posthog.reset();
    logger.info("reset");
  } catch (err) {
    logger.error("reset failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
