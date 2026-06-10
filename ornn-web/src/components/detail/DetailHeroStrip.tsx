/**
 * DetailHeroStrip — the shared top-of-page identity strip for detail pages
 * (skills + skillsets) (#1067).
 *
 * Presentational shell only: it owns the card chrome (letterpress impression,
 * hairline border, the icon / title / description / tag-row layout) and the
 * three optional content slots — `pills` (status pill row), `actions`
 * (right-side CTA cluster), and `footer` (e.g. the owner / published line).
 * No data, no domain logic. The skill and skillset hero adapters supply the
 * concrete pills + actions.
 *
 * Lifted out of `SkillHeroStrip` (#1067) so both detail surfaces render an
 * identical hero in the Forge Workshop language (DESIGN.md): Space Grotesk
 * display, Inter body, JetBrains Mono pills, ember accent, 2-4px radii.
 *
 * @module components/detail/DetailHeroStrip
 */

import type { ReactNode } from "react";

export interface DetailHeroStripProps {
  /** Square icon glyph (rendered inside the framed icon tile). */
  icon: ReactNode;
  title: string;
  /** Stable id for the title heading so `aria-labelledby` can target it. */
  titleId?: string;
  description?: string | undefined;
  /** Inline tag / category row under the description. */
  tagRow?: ReactNode;
  /** Status pill row (visibility / version / audit / kind …). */
  pills?: ReactNode;
  /** Bottom metadata line (owner / published / updated …). */
  footer?: ReactNode;
  /** Right-side action cluster (CTAs + icon buttons). Hidden when absent. */
  actions?: ReactNode;
}

export function DetailHeroStrip({
  icon,
  title,
  titleId = "detail-hero-name",
  description,
  tagRow,
  pills,
  footer,
  actions,
}: DetailHeroStripProps) {
  return (
    <section
      className="rounded-md border border-subtle bg-card p-6 card-impression"
      aria-labelledby={titleId}
    >
      <div className="grid gap-6 md:grid-cols-[auto_1fr_auto] md:items-start">
        {/* Icon */}
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border border-strong-edge bg-warning-soft text-accent"
          aria-hidden
        >
          {icon}
        </div>

        {/* Body */}
        <div className="min-w-0">
          <h1
            id={titleId}
            className="font-display text-3xl font-semibold leading-tight text-strong tracking-tight break-words"
          >
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-[64ch] font-text text-sm leading-relaxed text-body break-words">
              {description}
            </p>
          )}

          {tagRow && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] text-meta">
              {tagRow}
            </div>
          )}

          {pills && <div className="mt-3 flex flex-wrap gap-2">{pills}</div>}

          {footer && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-meta">
              {footer}
            </div>
          )}
        </div>

        {/* Actions */}
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </section>
  );
}
