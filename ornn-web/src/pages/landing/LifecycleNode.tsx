/**
 * LifecycleNode — one stage marker on the landing orbital ring.
 *
 * A button (disclosure trigger) positioned on the circle via polar geometry.
 * Resting: a hairline icon disc + a mono micro-label below it, with a faint
 * "travelling pulse" that lights each node in turn as the comet sweeps past
 * (CSS, comet-synced via `--lc-i`). Active (hover / focus / tap): the disc
 * ignites in its accent voice, the icon pops, a glow blooms, a conic accent
 * ring sweeps the rim, and a one-shot ripple pings outward. Movement is
 * suppressed under reduced motion (DESIGN.md reduced-motion contract) — the
 * active state is then carried by color + glow alone.
 *
 * Layout: a static wrapper does the polar positioning + (-50%, -50%) centring
 * so Framer's animated transforms on the button (entrance scale) don't fight
 * the centring. Pointer-events are enabled only on the button so the looping
 * hero video stays interactive everywhere else.
 *
 * @module pages/landing/LifecycleNode
 */
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { LifecycleStage } from "./lifecycleStages";
import { stagePolar } from "./lifecycleStages";

export interface LifecycleNodeProps {
  stage: LifecycleStage;
  active: boolean;
  /** True when a different node is active — used to dim this one. */
  dimmed: boolean;
  reduced: boolean;
  /** id of the shared detail card, for aria-controls. */
  cardId: string;
  onActivate: () => void;
  onScheduleClear: () => void;
}

export function LifecycleNode({
  stage,
  active,
  dimmed,
  reduced,
  cardId,
  onActivate,
  onScheduleClear,
}: LifecycleNodeProps) {
  const { t } = useTranslation();
  const { xPct, yPct } = stagePolar(stage.order);
  const { Icon } = stage;

  const name = t(`landing.lifecycle.stages.${stage.id}.name`);
  const idx = String(stage.order).padStart(2, "0");
  const i = stage.order - 1; // 0-based — drives entrance stagger + travel phase
  const accentVar = stage.accent === "arc" ? "var(--color-arc)" : "var(--color-accent)";

  return (
    <div
      className="lifecycle-node-anchor pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        // accent + node index handed to the CSS conic ring / glow / travel pulse
        ["--lc-accent" as string]: accentVar,
        ["--lc-i" as string]: i,
      }}
    >
      <motion.button
        type="button"
        aria-expanded={active}
        aria-controls={cardId}
        aria-label={t("landing.lifecycle.ariaNode", { index: idx, name })}
        onMouseEnter={onActivate}
        onMouseLeave={onScheduleClear}
        onFocus={onActivate}
        onBlur={onScheduleClear}
        // Hover/focus/tap all just activate. Closing is handled by leaving
        // (mouse), blur (keyboard), or tap-outside (touch) — never a click-time
        // toggle, which would race onFocus and slam the card shut on tap.
        onClick={onActivate}
        className="lifecycle-node group pointer-events-auto flex cursor-pointer flex-col items-center gap-1.5 focus:outline-none"
        // Staggered clockwise entrance — the ring assembles itself on load.
        initial={reduced ? false : { opacity: 0, scale: 0.35 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          delay: reduced ? 0 : 0.4 + i * 0.07,
          type: "spring",
          stiffness: 240,
          damping: 16,
          mass: 0.7,
        }}
        whileHover={reduced ? {} : { scale: 1.04 }}
      >
        {/* Icon disc */}
        <motion.span
          className="lifecycle-node-disc relative grid place-items-center rounded-full border backdrop-blur-[10px]"
          data-active={active || undefined}
          initial={false}
          animate={reduced ? {} : { scale: active ? 1.12 : 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 22, mass: 0.7 }}
          style={{
            borderColor: active ? accentVar : "var(--color-border-strong)",
            backgroundColor: "var(--surface-overlay)",
            color: active ? accentVar : "var(--color-body)",
            opacity: dimmed ? 0.5 : 1,
          }}
        >
          {/* Icon with a small pop on activation. */}
          <motion.span
            className="grid place-items-center"
            initial={false}
            animate={reduced ? {} : { scale: active ? 1.1 : 1, rotate: active ? -6 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 14 }}
          >
            <Icon className="lifecycle-node-icon h-5 w-5 sm:h-[22px] sm:w-[22px]" aria-hidden="true" />
          </motion.span>

          {/* One-shot sonar ping on activation (re-mounts per activation). */}
          {active && !reduced && <span className="lifecycle-ripple" aria-hidden="true" />}
        </motion.span>

        {/* Mono label: "01 · SEARCH" */}
        <span
          className="lifecycle-node-label whitespace-nowrap font-mono text-[9px] font-semibold uppercase tracking-[0.18em] sm:text-[10px]"
          style={{
            color: active ? accentVar : dimmed ? "var(--color-meta)" : "var(--color-body)",
            textShadow: "0 1px 6px var(--color-page)",
          }}
        >
          <span className="opacity-60">{idx}</span>
          <span className="mx-1 opacity-40">·</span>
          {name}
        </span>
      </motion.button>
    </div>
  );
}
