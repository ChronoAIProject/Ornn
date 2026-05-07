/**
 * Activities page — deep-link stub.
 *
 * Issue #271 retired the in-Ornn activity feed. Audit / activity
 * data now lives in PostHog; this page exists so existing nav links
 * (`/admin/activities`) and bookmarks keep working but route the
 * user to the source of truth instead of a dead Mongo-backed list.
 *
 * @module pages/admin/ActivitiesPage
 */

import {
  isPostHogConfigured,
  postHogActivityUrl,
} from "@/lib/postHogLinks";

export function ActivitiesPage() {
  const configured = isPostHogConfigured();
  const href = postHogActivityUrl();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
          Activities
        </h1>
        <p className="mt-1 font-text text-meta">
          Platform activity feed lives in PostHog (issue #271).
        </p>
      </header>

      <div className="rounded border border-dashed border-subtle bg-elevated/40 p-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          [§ Now in PostHog]
        </p>
        <h2 className="mt-3 font-display text-xl font-semibold text-strong">
          Audit + activity feed moved to PostHog
        </h2>
        <p className="mx-auto mt-2 max-w-prose font-text text-sm leading-relaxed text-body">
          Every API request, login, skill mutation, and admin action is
          captured as a PostHog event. Use the PostHog Activity view to
          filter by user, event type, time range, and pivot into
          funnels or session replays.
        </p>
        {!configured && (
          <p className="mx-auto mt-3 max-w-prose font-mono text-[11px] text-meta">
            PostHog isn't configured yet — set the API key under
            Settings → Telemetry and restart ornn-api.
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="cta-letterpress inline-flex items-center gap-2 rounded-sm border border-strong-edge bg-card px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-strong hover:border-accent"
          >
            Open PostHog Activity ↗
          </a>
        </div>
      </div>
    </div>
  );
}
