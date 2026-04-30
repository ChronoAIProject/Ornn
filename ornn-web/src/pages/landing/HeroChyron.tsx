import { forwardRef } from "react";

type Props = {
  nameRef: React.RefObject<HTMLSpanElement | null>;
  pctRef: React.RefObject<HTMLSpanElement | null>;
  barFillRef: React.RefObject<HTMLSpanElement | null>;
};

/**
 * Bottom-left phase indicator: gear + "PHASE EMPTY / 000%" + bar.
 * HeroStage writes the text / width directly via the passed refs.
 * `data-state` on the outer element drives idle / ready styling.
 */
export const HeroChyron = forwardRef<HTMLDivElement, Props>(function HeroChyron(
  { nameRef, pctRef, barFillRef },
  outer,
) {
  return (
    <div
      ref={outer}
      data-state="idle"
      aria-hidden="true"
      className="flex items-center gap-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-ash"
    >
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center animate-spin [animation-duration:3.6s] data-[parent-state=idle]:animate-none data-[parent-state=idle]:opacity-55 data-[parent-state=ready]:animate-none data-[parent-state=ready]:[transform:rotate(-22.5deg)]">
        <svg viewBox="0 0 64 64" fill="none" className="block h-full w-full">
          <path
            fill="var(--color-ember)"
            fillRule="evenodd"
            d="M63.39,38.24 L59.46,37.46 A28,28 0 0,1 55.28,47.56 L58.61,49.78 A32,32 0 0,1 49.78,58.61 L47.56,55.28 A28,28 0 0,1 37.46,59.46 L38.24,63.39 A32,32 0 0,1 25.76,63.39 L26.54,59.46 A28,28 0 0,1 16.44,55.28 L14.22,58.61 A32,32 0 0,1 5.39,49.78 L8.72,47.56 A28,28 0 0,1 4.54,37.46 L0.61,38.24 A32,32 0 0,1 0.61,25.76 L4.54,26.54 A28,28 0 0,1 8.72,16.44 L5.39,14.22 A32,32 0 0,1 14.22,5.39 L16.44,8.72 A28,28 0 0,1 26.54,4.54 L25.76,0.61 A32,32 0 0,1 38.24,0.61 L37.46,4.54 A28,28 0 0,1 47.56,8.72 L49.78,5.39 A32,32 0 0,1 58.61,14.22 L55.28,16.44 A28,28 0 0,1 59.46,26.54 L63.39,25.76 A32,32 0 0,1 63.39,38.24 Z M46,32 A14,14 0 1,0 18,32 A14,14 0 1,0 46,32 Z"
          />
        </svg>
      </span>
      <span>PHASE</span>
      <span
        ref={nameRef}
        className="tracking-[0.22em] text-parchment data-[parent-state=ready]:text-ember"
      >
        EMPTY
      </span>
      <span className="text-[color:var(--color-border-strong)]">/</span>
      <span className="relative inline-block h-1 w-24 overflow-hidden rounded-[2px] border border-[color:var(--color-border-subtle)] bg-[rgb(201_191_173/0.10)]">
        <span
          ref={barFillRef}
          className="absolute inset-y-0 left-0 w-0 bg-[linear-gradient(90deg,var(--color-ember-dim),var(--color-ember))] shadow-[0_0_8px_-1px_var(--color-ember)] transition-[width] duration-[120ms] ease-linear"
        />
      </span>
      <span ref={pctRef} className="tabular-nums text-ember">
        000%
      </span>
    </div>
  );
});
