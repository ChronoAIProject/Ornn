/**
 * AgentSeal score-to-band mapping.
 *
 * #253 defines five bands. We re-skin them onto the Industrial Forge
 * palette (DESIGN.md) — the AgentSeal upstream uses raw consumer-app
 * greens / yellows / reds; Ornn's design language is mineral / forge,
 * so we map onto our `state` semantic tokens instead. The bands stay
 * data-equivalent but read as forge-credible rather than SaaS-bright.
 *
 * | Score   | Band      | Tone token            | Label         |
 * |---------|-----------|------------------------|---------------|
 * | 85–100  | excellent | success                | Excellent     |
 * | 70–84   | high      | success (lighter mix)  | High          |
 * | 50–69   | medium    | warning                | Medium        |
 * | 30–49   | low       | warning (deeper mix)   | Low risk      |
 * | 0–29    | critical  | danger                 | Critical      |
 *
 * Anchoring on success/warning/danger semantic tokens means a future
 * dark-vs-light theme tweak in DESIGN.md flows through without code
 * change. We never reach into raw color values here.
 *
 * @module lib/agentsealBand
 */

export type AgentSealBand =
  | "excellent"
  | "high"
  | "medium"
  | "low"
  | "critical";

export interface BandStyle {
  /** Forge-palette band tag — also used as the data-band attribute. */
  band: AgentSealBand;
  /** Human label used in the badge. */
  label: string;
  /** Tailwind class set for the badge surface (border + bg + text). */
  surface: string;
  /** Tailwind class set for the score-pill (solid swatch + page-bg ink). */
  swatch: string;
  /** Tailwind text-only class for the band label / icon strokes. */
  ink: string;
}

/**
 * Deterministic score → band mapping. Out-of-range scores clamp to the
 * nearest band so a malformed `score: -3` from the backend doesn't
 * blank-out the badge.
 */
export function scoreToBand(score: number): AgentSealBand {
  if (Number.isNaN(score)) return "critical";
  if (score >= 85) return "excellent";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 30) return "low";
  return "critical";
}

/**
 * Resolved style bundle for a band. Centralizing here keeps the badge
 * component declarative and lets test cases assert the mapping without
 * scraping JSX.
 */
export function bandStyle(band: AgentSealBand): BandStyle {
  switch (band) {
    case "excellent":
      return {
        band,
        label: "Excellent",
        surface: "border-success/40 bg-success-soft text-success",
        swatch: "bg-success text-page",
        ink: "text-success",
      };
    case "high":
      // Same success family, slightly cooler. Mirrors AgentSeal's
      // "light green" without breaking out of the forge palette.
      return {
        band,
        label: "High",
        surface: "border-success/30 bg-success-soft/70 text-success",
        swatch: "bg-success/85 text-page",
        ink: "text-success",
      };
    case "medium":
      return {
        band,
        label: "Medium",
        surface: "border-warning/40 bg-warning-soft text-warning",
        swatch: "bg-warning text-page",
        ink: "text-warning",
      };
    case "low":
      // Deeper warning — still in the brass / molten family per
      // DESIGN.md, but signals "needs attention" more strongly than
      // medium without yet being fired-clay danger.
      return {
        band,
        label: "Low risk",
        surface: "border-warning/60 bg-warning-soft text-warning",
        swatch: "bg-warning text-page",
        ink: "text-warning",
      };
    case "critical":
      return {
        band,
        label: "Critical",
        surface: "border-danger/40 bg-danger-soft text-danger",
        swatch: "bg-danger text-page",
        ink: "text-danger",
      };
  }
}

/**
 * Convenience wrapper — the most common call shape from components.
 */
export function styleForScore(score: number): BandStyle {
  return bandStyle(scoreToBand(score));
}

/** Pretty-print "AgentSeal vN.N.N" from the raw version string. */
export function formatAgentSealVersion(raw: string | undefined): string {
  if (!raw) return "AgentSeal";
  // Accept both "agentseal-0.4.1" and "0.4.1"; surface the version
  // number with the "AgentSeal" prefix in either case.
  const stripped = raw.replace(/^agentseal[-/]/i, "");
  return stripped === raw ? raw : `AgentSeal ${stripped}`;
}
