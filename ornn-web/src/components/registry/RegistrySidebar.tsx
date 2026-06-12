/**
 * RegistrySidebar — shared filter-sidebar primitives for every registry-style
 * browse surface (skills + skillsets) (#1067).
 *
 * These four building blocks were lifted VERBATIM out of `ExplorePage`'s
 * private sidebar so the skill registry and the skillset registry render an
 * identical filter language: a mono uppercase section header, a wrapping chip
 * list, a selectable chip with an optional count, and an italic empty state.
 *
 * Pure presentation — no data fetching, no URL coupling. The page decides
 * which facets exist and what each chip toggles.
 *
 * @module components/registry/RegistrySidebar
 */

import type { ReactNode } from "react";

/** A titled filter group: mono uppercase eyebrow + the group's body. */
export function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-meta">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Italic low-emphasis copy shown when a facet has no options. */
export function FilterEmpty({ children }: { children: ReactNode }) {
  return <p className="font-text text-xs text-meta italic">{children}</p>;
}

/** Wrapping row of filter chips. */
export function FilterChipList({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

export interface FilterChipProps {
  label: string;
  /** Optional facet count rendered as a trailing mono badge. */
  count?: number;
  selected: boolean;
  onClick: () => void;
}

/** A toggleable filter chip with the selected/idle ember treatment. */
export function FilterChip({ label, count, selected, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        inline-flex items-center gap-2 px-2.5 py-1 rounded-full border font-text text-xs transition-all cursor-pointer
        ${selected
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-accent/15 bg-elevated text-strong hover:border-accent/40"}
      `}
    >
      <span className="max-w-[180px] truncate">{label}</span>
      {count !== undefined && (
        <span
          className={`
            px-1.5 rounded font-mono text-[10px]
            ${selected ? "bg-accent/30" : "bg-bg-base/70 text-meta"}
          `}
        >
          {count}
        </span>
      )}
    </button>
  );
}
