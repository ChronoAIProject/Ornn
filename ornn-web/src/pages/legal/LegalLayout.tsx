/**
 * LegalLayout — shared shell for /legal/* pages (Privacy, Terms, AUP).
 *
 * Each legal document gets its own route and lives in this layout so
 * the visual treatment, typography, and cross-doc nav stay consistent.
 * Design follows DESIGN.md "Whole-App Application Guidance → App
 * Shell" — same letterpress + bracketed mono labels we use elsewhere.
 *
 * Legal copy is intentionally English-only at launch; translation can
 * follow once the policies stabilize. The on-page nav stays bilingual
 * via the i18n keys.
 *
 * @module pages/legal/LegalLayout
 */

import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { PageTransition } from "@/components/layout/PageTransition";

interface LegalLayoutProps {
  /** Mono uppercase eyebrow, e.g. "[ § 02 — PRIVACY POLICY ]". */
  eyebrow: string;
  /** Display headline, e.g. "Privacy Policy". */
  title: string;
  /** ISO date the doc was last revised. Surfaced under the headline. */
  lastUpdatedIso: string;
  /** Doc body — long-form sections. Inherits the prose styles below. */
  children: ReactNode;
}

/** Sibling nav targets — kept in sync with App.tsx route paths. */
const SIBLINGS: Array<{ to: string; label: string }> = [
  { to: "/legal/privacy", label: "Privacy" },
  { to: "/legal/terms", label: "Terms of Service" },
  { to: "/legal/acceptable-use", label: "Acceptable Use" },
];

export function LegalLayout({
  eyebrow,
  title,
  lastUpdatedIso,
  children,
}: LegalLayoutProps) {
  return (
    <PageTransition>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[820px] px-4 py-12 sm:py-16 lg:py-20">
          <header className="mb-10 sm:mb-12">
            <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-meta">
              {eyebrow}
            </p>
            <h1 className="font-display text-[40px] font-bold leading-[1.05] tracking-tight text-strong sm:text-[52px]">
              {title}
            </h1>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-meta">
              Last updated {formatIsoDate(lastUpdatedIso)}
            </p>
          </header>

          {/* Cross-doc nav — small mono row so users can hop between
              the three policies without going back to the footer. */}
          <nav
            aria-label="Legal documents"
            className="mb-12 flex flex-wrap gap-x-5 gap-y-2 border-y border-subtle py-3"
          >
            {SIBLINGS.map((s) => (
              <NavLink
                key={s.to}
                to={s.to}
                className={({ isActive }) =>
                  `font-mono text-[11px] uppercase tracking-[0.18em] transition-colors ${
                    isActive
                      ? "text-accent"
                      : "text-meta hover:text-strong"
                  }`
                }
              >
                {s.label}
              </NavLink>
            ))}
          </nav>

          {/* Long-form prose. Sections + paragraphs use the standard
              tokens; we apply spacing via children-of selectors so each
              page can stay heads-down on content. */}
          <article className="space-y-8 font-text text-[16px] leading-relaxed text-body [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-[22px] [&_h2]:font-bold [&_h2]:text-strong [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:font-display [&_h3]:text-[16px] [&_h3]:font-semibold [&_h3]:text-strong [&_li]:mt-2 [&_p]:mt-3 [&_strong]:font-semibold [&_strong]:text-strong [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:opacity-80">
            {children}
          </article>

          <footer className="mt-16 flex items-center gap-3 border-t border-subtle pt-6">
            <span className="h-1 w-14 bg-accent" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-meta">
              Questions? Email{" "}
              <a
                href="mailto:legal@chrono-ai.fun"
                className="text-accent underline underline-offset-4 hover:opacity-80"
              >
                legal@chrono-ai.fun
              </a>
            </span>
          </footer>
        </div>
      </div>
    </PageTransition>
  );
}

function formatIsoDate(iso: string): string {
  // Stable EN-locale long form: "May 8, 2026". The legal pages are
  // English-only at launch; once translated, swap to the user's locale.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
