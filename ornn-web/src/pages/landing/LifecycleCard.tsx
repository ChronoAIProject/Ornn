/**
 * LifecycleCard — the detail card shown at the centre of the orbital ring
 * when a stage is active.
 *
 * Sits inside the ring interior (so it can never clip the viewport, unlike a
 * node-anchored flyout) and is tied to the active node by a drawn connector
 * line + the lit node itself. It enters *from the direction of its node*
 * (a small directional offset) so it still reads as "flying out" of the stage
 * the user pointed at, while staying anchored to a stable, legible centre.
 *
 * Content is agent-facing (CLAUDE.md → Product Positioning): every stage is
 * framed as something the agent does against the Ornn API, with a mono hint
 * line showing the relevant endpoint and a CTA into the matching surface.
 *
 * @module pages/landing/LifecycleCard
 */
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { LifecycleStage } from "./lifecycleStages";
import { stagePolar } from "./lifecycleStages";

export interface LifecycleCardProps {
  stage: LifecycleStage;
  reduced: boolean;
  id: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function LifecycleCard({ stage, reduced, id, onMouseEnter, onMouseLeave }: LifecycleCardProps) {
  const { t } = useTranslation();
  const { dx, dy } = stagePolar(stage.order);

  const name = t(`landing.lifecycle.stages.${stage.id}.name`);
  const idx = String(stage.order).padStart(2, "0");
  const accentVar = stage.accent === "arc" ? "var(--color-arc)" : "var(--color-accent)";

  // Enter from the node's direction: a small nudge outward toward the node.
  const enterOffset = reduced ? { x: 0, y: 0 } : { x: dx * 18, y: dy * 18 };

  return (
    <motion.div
      key={stage.id}
      id={id}
      role="dialog"
      aria-label={name}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      initial={{ opacity: 0, scale: reduced ? 1 : 0.94, ...enterOffset }}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, scale: reduced ? 1 : 0.97, transition: { duration: 0.12 } }}
      transition={{ duration: reduced ? 0.12 : 0.34, ease: [0.16, 1, 0.3, 1] }}
      className="lifecycle-card pointer-events-auto relative flex flex-col gap-2.5 rounded-[4px] border p-4 text-left backdrop-blur-[16px] sm:p-5"
      style={{
        maxWidth: "min(calc(var(--lc-size) * 0.7), 320px)",
        backgroundColor: "var(--surface-overlay)",
        borderColor: "var(--color-border-strong)",
        boxShadow: "var(--card-shadow-rest)",
      }}
    >
      {/* Accent rule + bracketed section label */}
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-[3px] rounded-full" style={{ backgroundColor: accentVar }} />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentVar }}>
          [§ {idx} — {name.toUpperCase()}]
        </span>
      </div>

      <h3 className="font-display text-[19px] font-bold uppercase leading-[1.05] tracking-[-0.02em] text-strong sm:text-[22px]">
        {t(`landing.lifecycle.stages.${stage.id}.title`)}
      </h3>

      <p className="text-[13px] leading-relaxed text-body sm:text-sm">
        {t(`landing.lifecycle.stages.${stage.id}.body`)}
      </p>

      {/* Mono endpoint hint — the agent-API contract made tangible. */}
      <code
        className="block truncate rounded-[3px] border px-2.5 py-1.5 font-mono text-[11px]"
        style={{
          borderColor: "var(--color-border-subtle)",
          backgroundColor: "var(--color-code-surface)",
          color: "var(--color-meta)",
        }}
      >
        <span style={{ color: accentVar }}>›</span>{" "}
        {t(`landing.lifecycle.stages.${stage.id}.hint`)}
      </code>

      <Link
        to={stage.ctaTo}
        className="focus-ring-ember mt-0.5 inline-flex items-center gap-1.5 self-start font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors"
        style={{ color: accentVar }}
      >
        {t(`landing.lifecycle.stages.${stage.id}.cta`)}
        <span aria-hidden="true">→</span>
      </Link>
    </motion.div>
  );
}
