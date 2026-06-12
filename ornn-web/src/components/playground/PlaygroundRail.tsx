/**
 * Right-edge drawer rail extracted from PlaygroundPage (#453).
 *
 * Always-visible vertical strip with one tab per drawer. Each tab has:
 *   - hover-peek: opens its drawer until the cursor leaves the rail
 *   - click: pins the drawer until the user clicks elsewhere
 *   - tooltip on the LEFT side that fades in on hover when the drawer
 *     isn't already open
 *   - optional warning dot (e.g. env vars incomplete)
 *   - active-pin marker (a 1px vertical line on the rail edge)
 *
 * Stateless — the parent owns activeDrawer + pinnedDrawer + the
 * open/close handlers.
 *
 * @module components/playground/PlaygroundRail
 */

import type { ComponentType } from "react";
import type { IconProps } from "@/components/icons";

export type DrawerKey = "package" | "env";

export interface PlaygroundRailTab {
  key: DrawerKey;
  ariaLabel: string;
  tip: string;
  Icon: ComponentType<IconProps>;
  /** Render a small warning dot to the left of the icon. */
  warn?: boolean;
}

export interface PlaygroundRailProps {
  tabs: PlaygroundRailTab[];
  activeDrawer: DrawerKey | null;
  pinnedDrawer: DrawerKey | null;
  onHoverOpen: (key: DrawerKey) => void;
  onHoverCloseScheduled: () => void;
  onTogglePin: (key: DrawerKey) => void;
}

export function PlaygroundRail({
  tabs,
  activeDrawer,
  pinnedDrawer,
  onHoverOpen,
  onHoverCloseScheduled,
  onTogglePin,
}: PlaygroundRailProps) {
  return (
    <div
      className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1"
      onMouseLeave={onHoverCloseScheduled}
    >
      {tabs.map((tab) => {
        const active = activeDrawer === tab.key;
        const Icon = tab.Icon;
        return (
          <button
            key={tab.key}
            type="button"
            onMouseEnter={() => onHoverOpen(tab.key)}
            onClick={() => onTogglePin(tab.key)}
            className={`group relative flex h-11 w-9 items-center justify-center rounded-l-sm border-y border-l transition-colors ${
              active
                ? "border-accent/60 bg-card text-accent"
                : "border-subtle bg-card/80 text-meta hover:border-accent/40 hover:text-strong"
            }`}
            aria-label={tab.ariaLabel}
          >
            <Icon className="h-4 w-4" />

            {/* Horizontal tooltip — fades in on hover when the drawer
                for this tab is not already open. Matches the drawer
                header voice `[§ NAME]`. */}
            {!active && (
              <span
                className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-sm border border-subtle bg-card px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-strong opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                aria-hidden
              >
                [§&nbsp;{tab.tip}]
              </span>
            )}

            {tab.warn && (
              <span
                className="absolute -left-1 top-1.5 h-1.5 w-1.5 rounded-full bg-warning"
                aria-hidden
              />
            )}
            {pinnedDrawer === tab.key && (
              <span
                className="absolute -left-px inset-y-2 w-px bg-accent"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
