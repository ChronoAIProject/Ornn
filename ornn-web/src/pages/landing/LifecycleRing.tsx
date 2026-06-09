/**
 * LifecycleRing — the orbital skill-lifecycle ring overlaid on the landing
 * hero video (#840 follow-up).
 *
 * A hairline circle carrying the eight agent-facing lifecycle stages
 * (search → preview → audit → install → execute → build → publish → share,
 * and back to search). An ember comet orbits clockwise to signal the loop and
 * its direction. Hovering / focusing / tapping a stage ignites that node, draws
 * a connector to the centre, and morphs the centre hub into a detail card for
 * the stage. The whole layer is `pointer-events-none` except the nodes and the
 * active card, so the looping video underneath stays untouched.
 *
 * Robustness choices:
 * - The detail card lives at the *centre* of the ring (never node-anchored), so
 *   it can never clip the viewport at any size; it still reads as a flyout via
 *   a directional entrance + the drawn connector + the lit node.
 * - Geometry is polar and unit-based (a square sizing box → percentage
 *   coordinates), so the circle stays perfectly round regardless of the hero's
 *   aspect ratio, and scales down cleanly to mobile.
 * - Reduced motion: the comet stops, node/card movement collapses to
 *   color + opacity (DESIGN.md reduced-motion contract). CSS keyframes are
 *   additionally gated by the media query in neon.css.
 *
 * @module pages/landing/LifecycleRing
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { LifecycleNode } from "./LifecycleNode";
import { LifecycleCard } from "./LifecycleCard";
import { LIFECYCLE_STAGES, stagePolar } from "./lifecycleStages";

const CARD_ID = "lifecycle-detail-card";
const CLEAR_DELAY_MS = 150;

export function LifecycleRing() {
  const { t } = useTranslation();
  const reduced = useReducedMotion() ?? false;
  const [activeId, setActiveId] = useState<string | null>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClear = () => {
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
  };
  const scheduleClear = () => {
    cancelClear();
    clearTimer.current = setTimeout(() => setActiveId(null), CLEAR_DELAY_MS);
  };
  const activate = (id: string) => {
    cancelClear();
    setActiveId(id);
  };

  // Tap-outside dismiss (touch + mouse), mirroring CategoryTooltip.
  useEffect(() => {
    if (!activeId) return;
    const onDown = (e: MouseEvent) => {
      if (ringRef.current && !ringRef.current.contains(e.target as Node)) {
        setActiveId(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [activeId]);

  useEffect(() => () => cancelClear(), []);

  const activeStage = LIFECYCLE_STAGES.find((s) => s.id === activeId) ?? null;
  // Connector endpoint: from centre out to just inside the active node disc.
  const link = activeStage ? stagePolar(activeStage.order, 40) : null;
  const linkAccent =
    activeStage?.accent === "arc" ? "var(--color-arc)" : "var(--color-accent)";

  // Comet tail geometry (clockwise; head at top). Computed once.
  const head = stagePolar(1, 42); // top, (50, 8)
  const tail = stagePolar(1 - 50 / 45, 42); // 50° behind the head

  return (
    <div
      aria-label={t("landing.lifecycle.ariaRing")}
      className="lifecycle-overlay pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
    >
      {/* Localized ambient heat — a soft radial under the ring. Accent glow as
          an accent, never baseline electrification (DESIGN.md). */}
      <div aria-hidden="true" className="lifecycle-ambient pointer-events-none absolute" />

      <div
        ref={ringRef}
        className="lifecycle-stage relative"
        role="group"
        aria-label={t("landing.lifecycle.ariaRing")}
        onBlur={(e) => {
          if (!ringRef.current?.contains(e.relatedTarget as Node)) scheduleClear();
        }}
      >
        {/* ── Ring + comet + connector (decorative) ── */}
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 100 100"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <radialGradient id="lc-comet-head" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--color-accent-support)" stopOpacity="1" />
              <stop offset="45%" stopColor="var(--color-accent)" stopOpacity="0.95" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </radialGradient>
            <linearGradient
              id="lc-comet-tail"
              gradientUnits="userSpaceOnUse"
              x1={tail.xPct}
              y1={tail.yPct}
              x2={head.xPct}
              y2={head.yPct}
            >
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.85" />
            </linearGradient>
          </defs>

          {/* faint outer + slowly counter-rotating dotted inner ring for depth */}
          <circle cx="50" cy="50" r="47" fill="none" stroke="var(--color-border-subtle)" strokeWidth="0.3" />
          <circle
            className={reduced ? undefined : "lifecycle-inner-ring"}
            cx="50"
            cy="50"
            r="33"
            fill="none"
            stroke="var(--color-border-subtle)"
            strokeWidth="0.3"
            strokeDasharray="0.5 3"
          />
          {/* main ring — hairline arc-blue (diagrammatic); draws itself in on mount */}
          <motion.circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="var(--color-arc-dim)"
            strokeWidth="0.45"
            strokeOpacity="0.55"
            initial={reduced ? false : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: reduced ? 0 : 1.1, ease: [0.16, 1, 0.3, 1] }}
          />

          {/* rivet dots at each stage angle */}
          {LIFECYCLE_STAGES.map((s) => {
            const p = stagePolar(s.order, 42);
            return (
              <circle
                key={`rivet-${s.id}`}
                cx={p.xPct}
                cy={p.yPct}
                r="0.7"
                fill="var(--color-border-stronger)"
              />
            );
          })}

          {/* connector from the active node to the centre card — a flowing
              dashed line so energy reads as travelling into the card */}
          <motion.line
            className={reduced ? undefined : "lifecycle-connector"}
            x1={50}
            y1={50}
            x2={link?.xPct ?? 50}
            y2={link?.yPct ?? 50}
            stroke={linkAccent}
            strokeWidth="0.5"
            strokeLinecap="round"
            initial={false}
            animate={{ opacity: activeStage ? 0.85 : 0 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ filter: `drop-shadow(0 0 1.4px ${linkAccent})` }}
          />

          {/* orbiting comet — clockwise, ember (action / brand voice) */}
          <motion.g
            className={reduced ? undefined : "lifecycle-comet"}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: reduced ? 0 : 0.9 }}
          >
            <path
              d={`M ${tail.xPct} ${tail.yPct} A 42 42 0 0 1 ${head.xPct} ${head.yPct}`}
              fill="none"
              stroke="url(#lc-comet-tail)"
              strokeWidth="1"
              strokeLinecap="round"
            />
            <circle cx={head.xPct} cy={head.yPct} r="2.4" fill="url(#lc-comet-head)" />
            <circle cx={head.xPct} cy={head.yPct} r="0.9" fill="var(--color-accent-support)" />
          </motion.g>
        </svg>

        {/* ── Centre: hub (rest) ⇄ detail card (active) ── */}
        <div className="absolute inset-0 grid place-items-center px-6">
          <AnimatePresence mode="wait" initial={false}>
            {activeStage ? (
              <LifecycleCard
                key={activeStage.id}
                stage={activeStage}
                reduced={reduced}
                id={CARD_ID}
                onMouseEnter={cancelClear}
                onMouseLeave={scheduleClear}
              />
            ) : (
              <motion.div
                key="hub"
                initial={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: reduced ? 1 : 0.97, transition: { duration: 0.1 } }}
                transition={{ duration: reduced ? 0.12 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="pointer-events-none flex flex-col items-center gap-1.5 text-center"
              >
                <span
                  className="font-display text-[22px] font-bold uppercase leading-[0.95] tracking-[-0.025em] text-strong sm:text-[28px]"
                  style={{ textShadow: "0 1px 12px var(--color-page)" }}
                >
                  {t("landing.lifecycle.hubTitle")}
                </span>
                <span
                  className="max-w-[14rem] text-[12px] leading-snug text-body"
                  style={{ textShadow: "0 1px 8px var(--color-page)" }}
                >
                  {t("landing.lifecycle.hubSubtitle")}
                </span>
                <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-meta">
                  {t("landing.lifecycle.hubHint")}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Stage nodes ── */}
        {LIFECYCLE_STAGES.map((stage) => (
          <LifecycleNode
            key={stage.id}
            stage={stage}
            active={activeId === stage.id}
            dimmed={activeId !== null && activeId !== stage.id}
            reduced={reduced}
            cardId={CARD_ID}
            onActivate={() => activate(stage.id)}
            onScheduleClear={scheduleClear}
          />
        ))}
      </div>
    </div>
  );
}
