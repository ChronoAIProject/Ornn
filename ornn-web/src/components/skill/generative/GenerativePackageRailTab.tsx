/**
 * Right-edge rail tab that opens the package drawer on the generative
 * page (#1242 decomposition of CreateSkillGenerativePage).
 *
 * Single tab (Package + actions). Carries three overlays:
 *   - the new-iteration hint — pulsing ember rings + an ember dot when a
 *     generation lands while the drawer is closed;
 *   - a horizontal `[§ PACKAGE]` tooltip on hover while closed;
 *   - a warning dot when the previewed SKILL.md has frontmatter errors.
 *
 * Stateless — the parent's `useGenerativeDrawer` owns open/pin state.
 *
 * @module components/skill/generative/GenerativePackageRailTab
 */

import { useTranslation } from "react-i18next";
import { PackageIcon } from "@/components/icons";

export interface GenerativePackageRailTabProps {
  drawerOpen: boolean;
  pinnedOpen: boolean;
  hasUnseenIteration: boolean;
  hasFrontmatterErrors: boolean;
  onHoverOpen: () => void;
  onHoverCloseScheduled: () => void;
  onTogglePin: () => void;
}

export function GenerativePackageRailTab({
  drawerOpen,
  pinnedOpen,
  hasUnseenIteration,
  hasFrontmatterErrors,
  onHoverOpen,
  onHoverCloseScheduled,
  onTogglePin,
}: GenerativePackageRailTabProps) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-1"
      onMouseLeave={onHoverCloseScheduled}
    >
      <button
        type="button"
        onMouseEnter={onHoverOpen}
        onClick={onTogglePin}
        className={`group relative flex h-11 w-9 items-center justify-center rounded-l-sm border-y border-l transition-colors ${
          drawerOpen
            ? "border-accent/60 bg-card text-accent"
            : hasUnseenIteration
              ? "border-accent bg-card text-accent"
              : "border-subtle bg-card/80 text-meta hover:border-accent/40 hover:text-strong"
        }`}
        aria-label={t("aria.skillPackageDrawer")}
      >
        <PackageIcon className="h-4 w-4" />

        {/* New-iteration hint — pulsing ember rings around the tab
            when a generation lands while the drawer is closed. Two
            layers: a steady accent ring + an `animate-ping` ring
            that scales out to draw the eye. Clears on drawer open. */}
        {hasUnseenIteration && !drawerOpen && (
          <>
            <span
              className="pointer-events-none absolute -inset-px rounded-l-sm ring-2 ring-accent/70"
              aria-hidden
            />
            <span
              className="pointer-events-none absolute -inset-px animate-ping rounded-l-sm ring-2 ring-accent/40"
              aria-hidden
            />
            {/* Small ember dot top-right to signal "new" even at the
                button's outer edge when ring blends into the card. */}
            <span
              className="pointer-events-none absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-accent"
              aria-hidden
            />
          </>
        )}

        {/* Horizontal tooltip — fades in on hover when the drawer is
            not already open. Matches the drawer header voice. */}
        {!drawerOpen && (
          <span
            className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-sm border border-subtle bg-card px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-strong opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            aria-hidden
          >
            [§&nbsp;PACKAGE]
          </span>
        )}

        {hasFrontmatterErrors && (
          <span
            className="absolute -left-1 top-1.5 h-1.5 w-1.5 rounded-full bg-warning"
            aria-hidden
          />
        )}
        {pinnedOpen && (
          <span
            className="absolute -left-px inset-y-2 w-px bg-accent"
            aria-hidden
          />
        )}
      </button>
    </div>
  );
}
