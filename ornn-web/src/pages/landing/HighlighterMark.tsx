import type { ReactNode } from "react";

/**
 * Forge Workshop brand emphasis pattern — a hand-applied translucent
 * highlighter wash sitting OVER the text. Replaces the legacy
 * italic-Fraunces-ember signature on landing surfaces (DESIGN.md →
 * Signature Emphasis → Highlighter Mark).
 *
 * The SVG turbulence filter that gives the wash its hand-drawn edges is
 * mounted ONCE per page via <HighlighterMarkFilter />. Mark instances
 * reference it via `filter: url(#ornn-highlighter-rough)` from the
 * `.highlighter-mark` CSS class. The ID is namespaced (`ornn-highlighter-`)
 * to avoid collision with arbitrary `id="hi-rough"` elements anywhere
 * else in the document.
 *
 * Variants:
 * - default → `--color-ember` wash (action voice)
 * - "arc"   → `--color-arc` wash (system / diagrammatic voice, restricted)
 * - "gold"  → `--color-molten` wash (supporting warmth)
 */
type Variant = "ember" | "arc" | "gold";

export function HighlighterMark({
  children,
  variant = "ember",
  className = "",
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  const cls =
    variant === "arc"
      ? "highlighter-mark highlighter-mark--arc"
      : variant === "gold"
        ? "highlighter-mark highlighter-mark--gold"
        : "highlighter-mark";
  return <span className={`${cls} ${className}`}>{children}</span>;
}

/**
 * Singleton SVG filter mount. Place once at the top of the landing page.
 * Renders an absolutely-positioned 0×0 SVG so the filter is in the DOM
 * but invisible. All <HighlighterMark /> instances on the page reference
 * it by ID.
 */
export function HighlighterMarkFilter() {
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
    >
      <defs>
        <filter id="ornn-highlighter-rough">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="2.4" />
        </filter>
      </defs>
    </svg>
  );
}
