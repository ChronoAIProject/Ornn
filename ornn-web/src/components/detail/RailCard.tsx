/**
 * RailCard — the shared right-rail card chrome for detail pages (skills +
 * skillsets) (#1067).
 *
 * Owns the card frame (letterpress impression, hairline border, padding) and
 * the dashed-underline mono eyebrow header used by every rail section. Slots:
 *   - `icon`        optional glyph before the title,
 *   - `headerRight` optional right-aligned header content (e.g. a count),
 *   - `tone`        `default` | `danger` — danger tints the header rule + text.
 *
 * Lifted out of `SkillVersionsCard` / `SkillVisibilityCard` (#1067) so the
 * skill and skillset rails render identical section chrome. Pure presentation.
 *
 * @module components/detail/RailCard
 */

import type { ReactNode } from "react";

export interface RailCardProps {
  title: string;
  icon?: ReactNode;
  headerRight?: ReactNode;
  /** `danger` tints the header rule + label kiln-red for destructive sections. */
  tone?: "default" | "danger";
  className?: string;
  children: ReactNode;
}

export function RailCard({
  title,
  icon,
  headerRight,
  tone = "default",
  className = "",
  children,
}: RailCardProps) {
  const headerTone =
    tone === "danger"
      ? "border-danger/30 text-danger"
      : "border-subtle text-meta";
  return (
    <section className={`rounded-md border border-subtle bg-card p-5 card-impression ${className}`}>
      <h3
        className={`mb-3.5 flex items-center gap-2 border-b border-dashed pb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${headerTone}`}
      >
        {icon}
        <span className="flex-1">{title}</span>
        {headerRight}
      </h3>
      {children}
    </section>
  );
}
