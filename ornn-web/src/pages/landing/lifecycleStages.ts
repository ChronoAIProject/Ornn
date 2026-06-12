/**
 * Skill-lifecycle stage data for the landing-page orbital ring (#840 follow-up).
 *
 * The eight stages model the agent-facing skill lifecycle described in
 * CLAUDE.md → Product Positioning: an agent calls Ornn to
 * `search → preview → audit → install → execute → build → publish → share`
 * and back to search. This is the agent-API contract visualized — not a
 * human marketplace browse flow — so the copy (in i18n) is written
 * agent-first.
 *
 * This module is structural only: stage id, ordering, the line icon, the
 * accent voice, and the CTA route. All human-readable copy lives in i18n
 * under `landing.lifecycle.stages.<id>` so it stays translatable. Geometry
 * (the angle each node sits at on the circle) is derived from `order` by the
 * ring component, keeping a single source of truth for the sequence.
 *
 * @module pages/landing/lifecycleStages
 */
import type { ComponentType, SVGProps } from "react";
import {
  AuditIcon,
  BuildIcon,
  ExecuteIcon,
  InstallIcon,
  PreviewIcon,
  PublishIcon,
  SearchIcon,
  ShareIcon,
} from "./lifecycleIcons";

/**
 * Accent voice per DESIGN.md → Brand color rule:
 * - "ember" → primary action voice (search / install / execute / build /
 *   publish / share).
 * - "arc"   → secondary *diagrammatic* voice, allowed here because a
 *   lifecycle diagram is exactly arc-blue's permitted role. Used for the
 *   inspection stages (preview / audit) so the ring reads bi-tonally without
 *   ember being sprayed everywhere.
 */
export type StageAccent = "ember" | "arc";

export interface LifecycleStage {
  /** Stable id; also the i18n key segment under landing.lifecycle.stages. */
  id: string;
  /** 1-based sequence position; drives the clockwise angle on the ring. */
  order: number;
  /** Line icon, 24×24, stroke=currentColor. */
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Accent voice — see StageAccent. */
  accent: StageAccent;
  /** Where the stage's card CTA links. All are existing public/app routes. */
  ctaTo: string;
}

/**
 * The lifecycle, in sequence. Order here IS the clockwise order on the ring
 * (search at the top, advancing clockwise back to search) and the comet's
 * direction of travel.
 */
export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  { id: "search", order: 1, Icon: SearchIcon, accent: "ember", ctaTo: "/registry" },
  { id: "preview", order: 2, Icon: PreviewIcon, accent: "arc", ctaTo: "/registry" },
  { id: "audit", order: 3, Icon: AuditIcon, accent: "arc", ctaTo: "/docs" },
  { id: "install", order: 4, Icon: InstallIcon, accent: "ember", ctaTo: "/docs" },
  { id: "execute", order: 5, Icon: ExecuteIcon, accent: "ember", ctaTo: "/playground" },
  { id: "build", order: 6, Icon: BuildIcon, accent: "ember", ctaTo: "/skills/new" },
  { id: "publish", order: 7, Icon: PublishIcon, accent: "ember", ctaTo: "/skills/new" },
  { id: "share", order: 8, Icon: ShareIcon, accent: "ember", ctaTo: "/registry" },
] as const;

/** Total stages — exported so geometry math has a single source. */
export const STAGE_COUNT = LIFECYCLE_STAGES.length;

/**
 * Polar position of a stage node on the unit ring, in SVG/percent space where
 * (50, 50) is the centre. `order` 1 sits at the top (−90°) and each subsequent
 * stage advances +45° clockwise. `radiusPct` is the distance from centre as a
 * percentage (nodes live at 42, the ring stroke at 42 too).
 *
 * Returns both the percentage coordinates (for absolutely-positioning the HTML
 * node) and the unit direction vector (for the card's directional entrance).
 */
export function stagePolar(order: number, radiusPct = 42) {
  const angleDeg = -90 + (order - 1) * (360 / STAGE_COUNT);
  const angleRad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);
  return {
    angleDeg,
    dx,
    dy,
    xPct: 50 + radiusPct * dx,
    yPct: 50 + radiusPct * dy,
  };
}
