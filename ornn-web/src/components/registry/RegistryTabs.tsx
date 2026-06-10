/**
 * RegistryTabs — the shared tab strip for registry-style browse surfaces
 * (skills + skillsets) (#1067).
 *
 * `TabButton` is the single source of truth for a tab's idle/active styling
 * and its optional trailing count badge — lifted out of `ExplorePage` so the
 * skill registry and the skillset registry render an identical strip.
 *
 * `RegistryTabs` is the centered, bordered wrapper. It auto-fits its columns
 * to the number of tabs so a 2-tab strip and a 4-tab strip both stay balanced
 * without each page hand-rolling the grid math.
 *
 * @module components/registry/RegistryTabs
 */

export interface RegistryTab {
  /** Stable key passed back to `onSelect`. */
  id: string;
  label: string;
  /** Optional facet count rendered as a trailing mono badge. */
  count?: number | undefined;
}

export interface RegistryTabsProps {
  tabs: RegistryTab[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Tailwind max-width utility for the strip (default `max-w-3xl`). */
  maxWidthClassName?: string | undefined;
}

export function RegistryTabs({
  tabs,
  activeId,
  onSelect,
  maxWidthClassName = "max-w-3xl",
}: RegistryTabsProps) {
  return (
    <div className="shrink-0 flex justify-center">
      <div
        className={`grid rounded border border-accent/20 bg-elevated p-1 gap-1 w-full ${maxWidthClassName}`}
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            label={tab.label}
            count={tab.count}
            active={tab.id === activeId}
            onClick={() => onSelect(tab.id)}
          />
        ))}
      </div>
    </div>
  );
}

export interface TabButtonProps {
  label: string;
  // exactOptionalPropertyTypes (#657)
  count?: number | undefined;
  active: boolean;
  onClick: () => void;
}

export function TabButton({ label, count, active, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        w-full px-3 py-2 rounded-md font-text text-sm transition-all cursor-pointer
        inline-flex items-center justify-center gap-2 whitespace-nowrap
        ${active
          ? "bg-accent/20 text-accent border border-accent/50"
          : "text-meta hover:text-strong"}
      `}
    >
      <span className="whitespace-nowrap">{label}</span>
      {count !== undefined && (
        <span
          className={`
            shrink-0 px-1.5 py-0.5 rounded font-mono text-[10px]
            ${active ? "bg-accent/30 text-accent" : "bg-elevated text-meta"}
          `}
        >
          {count}
        </span>
      )}
    </button>
  );
}
