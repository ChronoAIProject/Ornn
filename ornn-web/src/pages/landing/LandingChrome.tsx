/**
 * LandingChrome — Forge Workshop "printed object" chrome (DESIGN.md →
 * Material & Print Vocabulary).
 *
 * Renders two cumulative non-content signals on the landing surface:
 *
 *   1. Page-corner registration marks (both themes) — small ember
 *      crosshair + ring at all four viewport corners. Print-shop
 *      crop-mark vocabulary. Top corners anchor below the 64px sticky
 *      nav so they land at the page-content area's corners.
 *
 *   2. Drafting overlay (light mode only) — fixed page-edge dimension
 *      ruler down both viewport edges (dashed tick every 64px) plus a
 *      global blueprint grid backdrop on the body. Replaces the warm
 *      cream parchment field with a "drafting paper / technical
 *      document" gestalt. Dark mode skips this — its workshop signal
 *      comes from brushed-metal patina instead.
 *
 * Both elements are CSS-only (purely decorative pseudo-elements via the
 * containing div + style). No runtime layout data needed.
 *
 * Scoping: hosted inside `.landing-route` (set by LandingPage) so app-shell
 * routes never inherit any of this chrome — verified via the body-scoped
 * `[data-theme="light"] .landing-route ~ ...` selectors below being absent
 * (we use scoped class selectors only).
 */
export function LandingChrome() {
  return (
    <>
      {/* Drafting overlay: blueprint grid backdrop + page-edge dim rulers.
          Light mode only — dark mode has its own brushed-metal patina. */}
      <div className="landing-drafting-overlay" aria-hidden="true" />
      <div className="landing-edge-rule landing-edge-rule--left" aria-hidden="true" />
      <div className="landing-edge-rule landing-edge-rule--right" aria-hidden="true" />

      {/* Print-shop registration marks — both themes */}
      <div className="landing-page-regs" aria-hidden="true">
        <span className="landing-page-reg landing-page-reg--tl">
          <span className="landing-page-reg-ring" />
        </span>
        <span className="landing-page-reg landing-page-reg--tr">
          <span className="landing-page-reg-ring" />
        </span>
        <span className="landing-page-reg landing-page-reg--bl">
          <span className="landing-page-reg-ring" />
        </span>
        <span className="landing-page-reg landing-page-reg--br">
          <span className="landing-page-reg-ring" />
        </span>
      </div>
    </>
  );
}
