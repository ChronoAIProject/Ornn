import { forwardRef } from "react";
import { RAIL_SKILLS } from "./skillsData";

/**
 * Right-side skill registry panel that the hero animates from.
 *
 * HeroStage reads `data-row-idx` to locate the per-row anchor point for each
 * wire + flying chip, and toggles `data-state` on rows as they install.
 */
type Props = {
  railRef: React.RefObject<HTMLElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  countRef: React.RefObject<HTMLElement | null>;
};

export const RepoRail = forwardRef<HTMLElement, Props>(function RepoRail(
  { railRef, listRef, countRef },
  _outer,
) {
  // Use the passed railRef as the actual <aside> ref.
  return (
    <aside
      ref={railRef}
      className="relative z-[7] h-fit max-w-[360px] w-full self-center justify-self-end overflow-hidden rounded-[4px] border border-[color:var(--color-border-subtle)] [background-color:var(--surface-rail)] shadow-[0_30px_80px_-30px_rgb(0_0_0/0.7)] backdrop-blur-[10px] transition-opacity duration-500 data-[dimmed=true]:opacity-[0.45] max-[720px]:max-w-full max-[720px]:justify-self-stretch"
    >
      {/* Head */}
      <div className="flex items-center gap-2.5 border-b border-[color:var(--color-border-subtle)] [background-color:var(--surface-rail-head)] px-3.5 py-3 max-[720px]:py-2">
        <div className="relative h-[14px] w-[14px]">
          <span className="absolute inset-0 rounded-full bg-ember shadow-[0_0_8px_var(--color-ember)]" />
        </div>
        <div className="font-display text-[14px] tracking-[-0.01em] text-parchment">
          ornn <em className="italic text-ember">/ registry</em>
        </div>
        <div className="ml-auto font-mono text-[10px] tracking-[0.12em] text-ash">
          <strong ref={countRef} className="font-medium text-ember">
            0
          </strong>
          /{RAIL_SKILLS.length}
        </div>
      </div>

      {/* Search (decorative) — hidden on mobile to save vertical space */}
      <div className="flex items-center gap-2 border-b border-[color:var(--color-border-subtle)] [background-color:var(--surface-rail-search)] px-3.5 py-2.5 font-mono text-[11px] text-ash before:text-[13px] before:text-ember before:content-['⌕'] max-[720px]:hidden">
        <span>search frontend skills</span>
        <span className="inline-block h-[11px] w-px bg-ember animate-blink" />
      </div>

      {/* List */}
      <div
        ref={listRef}
        className="relative max-h-[62vh] overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden after:pointer-events-none after:absolute after:bottom-0 after:left-0 after:right-0 after:h-7 after:[background-image:var(--surface-rail-fade)] max-[720px]:max-h-[96px]"
      >
        {RAIL_SKILLS.map((s, i) => (
          <div
            key={s.idx}
            data-row-idx={i}
            data-target={s.target}
            className="group/row relative grid grid-cols-[22px_1fr_auto] items-center gap-2.5 border-b border-dashed border-[color:var(--color-border-subtle)] px-3.5 py-[7px] font-mono transition-[background,border-color] duration-200 last:border-b-0 data-[state=firing]:bg-[rgb(255_106_26/0.12)] data-[state=firing]:shadow-[inset_2px_0_0_var(--color-ember)] data-[state=installed]:bg-[rgb(255_106_26/0.05)] data-[state=installed]:border-b-[rgb(255_106_26/0.25)]"
          >
            <span className="text-[9px] tracking-[0.08em] text-ash">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[12px] tracking-[0.01em] text-parchment">
                {s.name}
              </span>
              <span className="text-[8px] uppercase tracking-[0.16em] text-ash">
                {s.tag}
              </span>
            </span>
            <span className="rounded-[2px] border border-[rgb(255_106_26/0.25)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-ember transition-[color,background,border-color] duration-200 group-data-[state=installed]/row:border-ember group-data-[state=installed]/row:bg-ember group-data-[state=installed]/row:text-obsidian group-data-[state=installed]/row:before:content-['✓_']">
              + add
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
});
