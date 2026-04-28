/**
 * Drafting-paper grid laid behind editorial sections. Differentiates the
 * surface from generic warm-cream AI-brand layouts. Token-driven so the
 * line color flips between dark/light themes.
 */
export function BlueprintGrid({
  className = "",
  fade = true,
}: {
  className?: string;
  /** When true, mask edges so the grid feels like a clipped drafting sheet. */
  fade?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 [background-image:var(--pattern-grid)] [background-size:var(--pattern-grid-size)] ${
        fade
          ? "[mask-image:radial-gradient(ellipse_85%_70%_at_50%_50%,black_40%,transparent)]"
          : ""
      } ${className}`}
    />
  );
}

/**
 * Corner registration mark — like a printer's crop mark. Pair four at a
 * card or section corner to feel architectural / drafted-by-hand.
 */
export function RegMark({
  position,
  className = "",
}: {
  position: "tl" | "tr" | "bl" | "br";
  className?: string;
}) {
  const placement = {
    tl: "top-2 left-2 [transform:rotate(0deg)]",
    tr: "top-2 right-2 [transform:rotate(90deg)]",
    bl: "bottom-2 left-2 [transform:rotate(-90deg)]",
    br: "bottom-2 right-2 [transform:rotate(180deg)]",
  }[position];
  return (
    <span
      aria-hidden="true"
      className={`absolute z-10 inline-block h-2.5 w-2.5 ${placement} ${className}`}
    >
      <span className="absolute left-0 top-0 h-px w-full bg-ember" />
      <span className="absolute left-0 top-0 h-full w-px bg-ember" />
    </span>
  );
}
