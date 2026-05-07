/**
 * RecentActivities — deep-link card on the admin dashboard.
 *
 * Issue #271 retired the in-Ornn activity feed; the Mongo-backed
 * list and `GET /admin/dashboard/recent-activities` endpoint are
 * gone. This card keeps the dashboard slot but routes admins to
 * PostHog (the new source of truth) rather than rendering events
 * locally.
 *
 * @module components/admin/RecentActivities
 */

import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import {
  isPostHogConfigured,
  postHogActivityUrl,
  postHogInsightsUrl,
} from "@/lib/postHogLinks";

export function RecentActivities() {
  const configured = isPostHogConfigured();
  const activityUrl = postHogActivityUrl();
  const insightsUrl = postHogInsightsUrl();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.25 }}
    >
      <Card>
        <header className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold uppercase tracking-tight text-strong">
            Recent activity
          </h2>
        </header>

        <p className="font-text text-sm leading-relaxed text-body">
          Audit + activity events live in PostHog. Every API request,
          login, skill mutation, and admin action is captured there as
          a typed event with caller, source IP, status, and timing —
          searchable, filterable, and pivotable into funnels.
        </p>

        {!configured && (
          <p className="mt-3 font-mono text-[11px] text-meta">
            PostHog isn't configured yet — set it up under Settings →
            Telemetry.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={activityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-sm border border-strong-edge bg-card px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-strong hover:border-accent"
          >
            Activity feed ↗
          </a>
          <a
            href={insightsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-sm border border-strong-edge bg-card px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-strong hover:border-accent"
          >
            Insights ↗
          </a>
        </div>
      </Card>
    </motion.div>
  );
}
