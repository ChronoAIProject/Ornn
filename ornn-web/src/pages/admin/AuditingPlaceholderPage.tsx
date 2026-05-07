/**
 * AuditingPlaceholderPage — placeholder route for the upcoming auditing
 * surface (skill audits, audit log, risk scoring views).
 *
 * Today the data backing this page is fragmented across the activities
 * table and per-skill audit history. Stubbing the route keeps the IA
 * stable so the future page can ship without re-shuffling sidebar
 * indices.
 *
 * @module pages/admin/AuditingPlaceholderPage
 */

import { Link } from "react-router-dom";

export function AuditingPlaceholderPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight text-strong">
          Auditing
        </h1>
        <p className="mt-1 font-text text-meta">
          Cross-cutting audit surface — coming soon.
        </p>
      </header>

      <div className="rounded border border-dashed border-subtle bg-elevated/40 p-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          [§ COMING SOON]
        </p>
        <h2 className="mt-3 font-display text-xl font-semibold text-strong">
          Auditing dashboard isn't ready yet
        </h2>
        <p className="mx-auto mt-2 max-w-prose font-text text-sm leading-relaxed text-body">
          We're consolidating skill audits, risk scoring, and admin action
          history into a single surface. Until then, see existing telemetry
          and per-skill audit pages.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            to="/admin/settings/telemetry"
            className="cta-letterpress cta-letterpress--ghost inline-flex items-center gap-2 rounded-sm border border-strong-edge bg-card px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-strong hover:border-accent"
          >
            Telemetry settings
          </Link>
          <Link
            to="/admin/activities"
            className="cta-letterpress cta-letterpress--ghost inline-flex items-center gap-2 rounded-sm border border-strong-edge bg-card px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-strong hover:border-accent"
          >
            Activities log
          </Link>
        </div>
      </div>
    </div>
  );
}
