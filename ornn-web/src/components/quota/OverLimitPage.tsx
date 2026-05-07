/**
 * OverLimitPage — surface-level "you've hit your limit" page.
 *
 * Rendered when the playground or skill-gen page sees a 429 from the
 * backend's `QUOTA_EXCEEDED` shape, or pre-emptively when the cached
 * quota snapshot already shows zero remaining for the surface.
 *
 * Brand-consistent (Forge Workshop tokens — letterpress card, Space
 * Grotesk display, mono micro-labels) and screenshot-friendly per #250.
 *
 * @module components/quota/OverLimitPage
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { Surface, SurfaceSnapshot } from "@/services/quotaApi";

const SURFACE_LABEL: Record<Surface, string> = {
  playground: "Playground",
  skillGen: "Skill Generation",
};

interface OverLimitPageProps {
  surface: Surface;
  snapshot: SurfaceSnapshot;
  /** ISO of the next monthly reset — passed in from the caller's quota
   * snapshot so OverLimitPage stays a pure presentation component. */
  resetAt: string;
  /** Override message (used when the 429 carried server-side context). */
  message?: string;
}

function formatReset(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export function OverLimitPage({
  surface,
  snapshot,
  resetAt,
  message,
}: OverLimitPageProps) {
  const label = SURFACE_LABEL[surface];
  const ceiling = snapshot.defaultAllotment + snapshot.adminGrant;
  const heading = `You've hit your monthly ${label.toLowerCase()} limit.`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center py-12"
    >
      <div className="card-impression w-full rounded border border-subtle bg-card p-8 sm:p-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
          [§ QUOTA — LIMIT REACHED]
        </p>

        <h1 className="mt-4 font-display text-3xl font-bold uppercase tracking-tight text-strong sm:text-4xl">
          {heading}
        </h1>

        <p className="mt-4 max-w-prose font-text text-base leading-relaxed text-body">
          {message ??
            `You've used ${snapshot.used} of ${ceiling} ${label.toLowerCase()} calls this month. Quota refreshes ${formatReset(resetAt)}.`}
        </p>

        <dl className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded border border-subtle bg-elevated/40 p-4">
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Monthly used
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold text-strong">
              {snapshot.used}
              <span className="text-base font-medium text-meta">
                {" "}
                / {ceiling}
              </span>
            </dd>
          </div>
          <div className="rounded border border-subtle bg-elevated/40 p-4">
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Admin grant
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold text-accent">
              +{snapshot.adminGrant}
            </dd>
          </div>
          <div className="rounded border border-subtle bg-elevated/40 p-4">
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
              Resets
            </dt>
            <dd className="mt-1 font-mono text-sm text-strong">
              {formatReset(resetAt)}
            </dd>
          </div>
        </dl>

        <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <a
            href="mailto:hello@chrono-ai.fun?subject=Ornn%20quota"
            className="cta-letterpress inline-flex items-center gap-2 rounded-sm border border-accent-muted bg-accent px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-page hover:bg-accent-muted"
          >
            Contact admin for grant
          </a>
          <Link
            to="/registry"
            className="cta-letterpress cta-letterpress--ghost inline-flex items-center gap-2 rounded-sm border border-strong-edge bg-card px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-strong hover:border-accent"
          >
            Back to registry
          </Link>
        </div>

        <p className="mt-6 font-text text-xs text-meta">
          Admin grants are added to the current month and reset with the UTC
          calendar boundary. Paid plans are coming soon.
        </p>
      </div>
    </motion.div>
  );
}
