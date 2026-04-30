import { useEffect, useRef } from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { PhoneMockup } from "./PhoneMockup";
import { RepoRail } from "./RepoRail";
import { HeroChyron } from "./HeroChyron";
import { Stamp } from "./Stamp";
import { EmberLink } from "./EmberButton";
import { HighlighterMark } from "./HighlighterMark";
import { RAIL_SKILLS, type RailTarget } from "./skillsData";

/** Scroll-scrub thresholds — copied verbatim from the reference script. */
const HOLD_FROM = 0.88;
const WIRE_START = 0.06;
const WIRE_FULL = 0.24;
const STYLED_START = 0.4;
const STYLED_FULL = 0.7;
const FINAL_AT = 0.78;
const ITEM_BASE = 0.28;
const ITEM_STEP = 0.026;
const ITEM_DUR = 0.05;

const TARGETS: RailTarget[] = ["nav", "type", "media", "cards", "cta"];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * The 820vh sticky-pinned hero. A spring-smoothed scroll progress drives:
 * blank → wireframe → styled phone build, 16 wires firing chips from the
 * right-hand rail into target regions on the phone, a phase chyron, and a
 * final CTA overlay.
 *
 * Reduced-motion users and mobile viewports get a static "READY" snapshot
 * instead of the scroll narrative.
 */
export function HeroStage() {
  const reduced = useReducedMotion();
  // Mobile keeps the scrub but with a redesigned 2-col layout: the phone
  // is half-cut on the left edge, the rail sits on the right, and the
  // wires arc between them. Intro spans above. Only reduced-motion users
  // get the static hero (with skill marquee) since they opt out of motion.
  const staticMode = Boolean(reduced);

  return staticMode ? <StaticHero /> : <ScrubHero />;
}

/* ────────────────────────────────────────────────────────────
   Active scroll-scrub
   ──────────────────────────────────────────────────────────── */

function ScrubHero() {
  const heroRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);

  // Phone + rail + chyron refs (passed down to sub-components)
  const phoneRef = useRef<HTMLDivElement>(null);
  const layerBlankRef = useRef<HTMLDivElement>(null);
  const layerWireRef = useRef<HTMLDivElement>(null);
  const layerStyledRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLElement>(null);
  const chyronRef = useRef<HTMLDivElement>(null);
  const chyronNameRef = useRef<HTMLSpanElement>(null);
  const chyronPctRef = useRef<HTMLSpanElement>(null);
  const chyronBarRef = useRef<HTMLSpanElement>(null);

  // Local refs HeroStage owns
  const progressRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const finalRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const chipLayerRef = useRef<HTMLDivElement>(null);

  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const chipRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const targetEls = useRef<Partial<Record<RailTarget, HTMLElement>>>({});
  const itemState = useRef<Array<"idle" | "firing" | "landed">>(
    RAIL_SKILLS.map(() => "idle"),
  );
  const lastFiringIdx = useRef<number>(-1);
  const inView = useRef<boolean>(true);

  // Scroll progress, remapped + spring-smoothed
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end end"],
  });
  const remapped = useTransform(scrollYProgress, [0, HOLD_FROM, 1], [0, 1, 1]);
  const p = useSpring(remapped, { stiffness: 140, damping: 22 });

  // Collect rail row refs once mounted
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = Array.from(
      list.querySelectorAll<HTMLElement>("[data-row-idx]"),
    );
    rowRefs.current = rows;
    // Locate target elements in the styled layer (one of each target key)
    const styled = layerStyledRef.current;
    if (styled) {
      const map: Partial<Record<RailTarget, HTMLElement>> = {};
      for (const t of TARGETS) {
        const el = styled.querySelector<HTMLElement>(`[data-target='${t}']`);
        if (el) map[t] = el;
      }
      targetEls.current = map;
    }
  }, []);

  // Pause the rAF cost when off-screen
  useEffect(() => {
    const node = heroRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        inView.current = e?.isIntersecting ?? true;
      },
      { rootMargin: "200px 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  // The actual per-frame work — driven by smoothed motion-value
  useMotionValueEvent(p, "change", (vRaw) => {
    if (!inView.current) return;
    const sticky = stickyRef.current;
    const svg = svgRef.current;
    const styled = layerStyledRef.current;
    const wire = layerWireRef.current;
    const blank = layerBlankRef.current;
    if (!sticky || !svg || !styled || !wire || !blank) return;

    const v = clamp01(vRaw);

    // ── Chrome ──
    if (progressRef.current) progressRef.current.style.width = `${v * 100}%`;
    if (chyronPctRef.current) {
      chyronPctRef.current.textContent =
        String(Math.round(v * 100)).padStart(3, "0") + "%";
    }
    if (chyronBarRef.current) {
      chyronBarRef.current.style.width = `${(v * 100).toFixed(1)}%`;
    }
    if (chyronNameRef.current) {
      let n = "EMPTY";
      if (v > 0.06 && v <= 0.22) n = "WIREFRAME";
      else if (v > 0.22 && v <= 0.6) n = "INSTALLING";
      else if (v > 0.6 && v < 0.995) n = "TUNING";
      else if (v >= 0.995) n = "READY";
      chyronNameRef.current.textContent = n;
    }
    if (chyronRef.current) {
      const state =
        v < 0.02 ? "idle" : v >= 0.995 ? "ready" : "active";
      chyronRef.current.dataset.state = state;
      // Cascade to descendants via a separate attribute the gear/name read
      chyronRef.current
        .querySelectorAll<HTMLElement>("[data-parent-state]")
        .forEach((el) => {
          el.dataset.parentState = state;
        });
      chyronRef.current.querySelectorAll<HTMLElement>("*").forEach((el) => {
        if (el.dataset.parentState !== undefined)
          el.dataset.parentState = state;
      });
    }
    if (introRef.current) {
      introRef.current.dataset.off = v > 0.22 ? "true" : "false";
    }

    // ── Layer opacities ──
    blank.style.opacity = (1 - clamp01((v - 0.04) / 0.08)).toFixed(3);

    const wireIn = clamp01((v - WIRE_START) / 0.08);
    const wireOut = clamp01((v - 0.44) / 0.18);
    wire.style.opacity = Math.min(wireIn, 1 - wireOut).toFixed(3);

    const wireProg = clamp01(
      (v - WIRE_START) / (WIRE_FULL - WIRE_START),
    );
    const wireBoxes = wire.querySelectorAll<HTMLElement>("div, span");
    // (each wire-box's reveal is purely opacity/transform — handled by the
    //  per-frame wireProg below; we keep this lightweight.)
    let wb = 0;
    for (const el of wireBoxes) {
      if (!el.classList.contains("rounded-[3px]")) continue;
      const wi = (wb + 1) / 12;
      const on = wireProg >= wi;
      el.style.opacity = on ? "1" : "0";
      el.style.transform = on ? "translateY(0)" : "translateY(4px)";
      el.style.transition = "opacity 0.4s ease, transform 0.4s ease";
      wb++;
    }

    const styledIn = clamp01(
      (v - STYLED_START) / (STYLED_FULL - STYLED_START),
    );
    styled.style.opacity = styledIn.toFixed(3);
    styled.dataset.on = styledIn > 0.3 ? "true" : "false";

    if (phoneRef.current)
      phoneRef.current.dataset.settled = v > 0.55 ? "true" : "false";

    // ── SVG viewBox ──
    const sr = sticky.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${sr.width} ${sr.height}`);
    svg.setAttribute("width", String(sr.width));
    svg.setAttribute("height", String(sr.height));

    // ── Detect rail orientation. On desktop the rail sits beside the
    //    phone (chips fly horizontally); on mobile it sits below (chips
    //    rise from the rail's top edge). ──
    const phoneRect = phoneRef.current?.getBoundingClientRect();
    const railRect = railRef.current?.getBoundingClientRect();
    const railBelow =
      phoneRect && railRect ? railRect.top >= phoneRect.bottom - 8 : false;
    // Anchor wire origins to the RAIL CONTAINER's outer edge — never the
    // row's interior position. The rail-list internally auto-scrolls to
    // keep the firing row visible (see scrollTo below); without this
    // anchor, landed wires would slide with the internal scroll and
    // appear to "move with scroll" instead of staying tied to the
    // registry window. Per DESIGN.md → Hero-Only Patterns + Material
    // & Print Vocabulary.
    //
    // Mobile (railBelow): rail sits below the phone — emerge from rail's
    //   TOP edge, fanned across width by index.
    // Desktop: rail sits to the right of the phone — emerge from rail's
    //   LEFT (phone-facing) edge, fanned across height by index.
    const railTopY = railRect ? railRect.top - sr.top : 0;
    const railLeftX = railRect ? railRect.left - sr.left : 0;
    const railWidth = railRect ? railRect.width : sr.width;
    const railHeight = railRect ? railRect.height : sr.height;

    // ── 16 items ──
    let installed = 0;
    let firingIdx = -1;
    for (let i = 0; i < RAIL_SKILLS.length; i++) {
      const skill = RAIL_SKILLS[i];
      const start = ITEM_BASE + i * ITEM_STEP;
      const local = (v - start) / ITEM_DUR;
      const path = pathRefs.current[i];
      const chip = chipRefs.current[i];
      const row = rowRefs.current[i];
      const target = targetEls.current[skill.target];
      if (!path || !chip || !row || !target) continue;

      const rTar = target.getBoundingClientRect();
      const tx = rTar.left + rTar.width / 2 - sr.left;
      const ty = rTar.top + rTar.height / 2 - sr.top;
      // Origin: rail container's outer phone-facing edge — fanned by
      // index so the 16 wires read as parallel arcs, not stacked. NEVER
      // the row's interior bounding rect — that scrolls with the
      // rail-list and would drag landed wires.
      const spread = (i + 0.5) / RAIL_SKILLS.length;
      const ox = railBelow
        ? railLeftX + (0.06 + spread * 0.88) * railWidth
        : railLeftX;
      const oy = railBelow
        ? railTopY
        : railTopY + (0.08 + spread * 0.84) * railHeight;
      const dx = tx - ox;
      const c1x = ox + dx * 0.35;
      const c1y = oy;
      const c2x = ox + dx * 0.65;
      const c2y = ty;
      path.setAttribute(
        "d",
        `M ${ox.toFixed(1)} ${oy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`,
      );

      if (local <= 0) {
        chip.style.opacity = "0";
        path.style.opacity = "0";
        path.style.strokeWidth = "1.2";
        row.dataset.state = "idle";
        itemState.current[i] = "idle";
      } else if (local < 1) {
        firingIdx = i;
        const e = easeOutCubic(local);
        const t = e;
        const mt = 1 - t;
        const x =
          mt * mt * mt * ox +
          3 * mt * mt * t * c1x +
          3 * mt * t * t * c2x +
          t * t * t * tx;
        const y =
          mt * mt * mt * oy +
          3 * mt * mt * t * c1y +
          3 * mt * t * t * c2y +
          t * t * t * ty;
        chip.style.opacity = Math.min(1, local * 2.5).toFixed(3);
        chip.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${(0.92 + e * 0.08).toFixed(3)})`;
        path.style.opacity = "0.85";
        path.style.strokeWidth = "1.8";
        row.dataset.state = "firing";
        itemState.current[i] = "firing";
      } else {
        chip.style.opacity = "0";
        path.style.opacity = "0.55";
        path.style.strokeWidth = "1.2";
        row.dataset.state = "installed";
        if (itemState.current[i] !== "landed") {
          itemState.current[i] = "landed";
          // Fire one-shot wire+target halo
          path.animate(
            [
              { strokeWidth: "1.2", opacity: 0.55 },
              { strokeWidth: "2.6", opacity: 1 },
              { strokeWidth: "1.2", opacity: 0.55 },
            ],
            { duration: 650, easing: "ease-out" },
          );
          if (target instanceof HTMLElement) {
            target.animate(
              [
                { boxShadow: "0 0 0 0 rgba(255,106,26,0)" },
                {
                  boxShadow:
                    "0 0 0 6px rgba(255,106,26,0.25), 0 0 22px rgba(255,106,26,0.5)",
                },
                { boxShadow: "0 0 0 0 rgba(255,106,26,0)" },
              ],
              { duration: 650, easing: "ease-out" },
            );
          }
        }
        installed++;
      }
    }

    if (countRef.current) countRef.current.textContent = String(installed);

    // Auto-scroll the rail to keep the firing row in view
    if (firingIdx >= 0 && firingIdx !== lastFiringIdx.current) {
      lastFiringIdx.current = firingIdx;
      const list = listRef.current;
      const target = rowRefs.current[firingIdx];
      if (list && target) {
        const lr = list.getBoundingClientRect();
        const tr = target.getBoundingClientRect();
        const desired = list.scrollTop + (tr.top - lr.top) - lr.height * 0.33;
        list.scrollTo({ top: desired, behavior: "smooth" });
      }
    }

    // Final CTA overlay + dimming
    if (finalRef.current) {
      finalRef.current.dataset.on = v > FINAL_AT ? "true" : "false";
    }
    if (phoneRef.current) {
      phoneRef.current.dataset.dimmed = v > FINAL_AT ? "true" : "false";
    }
    if (railRef.current) {
      railRef.current.dataset.dimmed = v > FINAL_AT ? "true" : "false";
    }
  });

  return (
    <section
      id="hero"
      ref={heroRef}
      className="relative h-[820vh]"
      aria-label="Ornn product overview"
    >
      <div
        ref={stickyRef}
        className="sticky top-0 h-screen min-h-[720px] overflow-hidden bg-page"
      >
        {/* Top progress bar */}
        <div
          ref={progressRef}
          aria-hidden="true"
          className="absolute left-0 top-0 z-40 h-0.5 w-0 bg-ember shadow-[0_0_18px_rgb(255_106_26/0.55)]"
        />

        <ForgeBackground />
        <ForgeFloor />

        {/* Wires layer (over everything but chips/final) */}
        <svg
          ref={svgRef}
          className="pointer-events-none absolute inset-0 z-[6] overflow-visible"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {RAIL_SKILLS.map((s, i) => (
            <path
              key={s.idx}
              ref={(el) => {
                pathRefs.current[i] = el;
              }}
              fill="none"
              stroke="var(--color-ember)"
              strokeWidth="1.2"
              opacity="0"
              style={{
                transition: "opacity 0.3s ease",
                filter: "drop-shadow(0 0 3px rgb(255 106 26 / 0.6))",
              }}
            />
          ))}
        </svg>

        {/* Stage grid — capped at 1320px so the rail/intro don't stretch
            across ultrawide viewports. The outer wrapper still spans
            inset-0 so the chyron / progress bar / scroll hint chrome
            anchors to the full viewport. */}
        <div className="absolute inset-0 z-[5] flex items-center justify-center">
        <div className="grid w-full max-w-[1320px] items-center gap-0 px-12 pb-20 pt-[100px] [grid-template-columns:380px_1fr_360px] max-[1100px]:[grid-template-columns:1fr_320px] max-[1100px]:px-6 max-[720px]:[grid-template-columns:1fr] max-[720px]:[grid-template-rows:auto_1fr_auto] max-[720px]:gap-y-3 max-[720px]:px-6 max-[720px]:pb-6 max-[720px]:pt-12">
          {/* Intro / chyron. Hidden at the tablet breakpoint; restored on
              mobile above the phone so users immediately see what Ornn is. */}
          <div className="self-center max-[1100px]:hidden max-[720px]:!block max-[720px]:row-start-1 max-[720px]:self-start">
            <div
              ref={introRef}
              data-off="false"
              className="pointer-events-none transition-opacity duration-300 data-[off=true]:opacity-[0.18]"
            >
              <div className="mb-5 max-[720px]:mb-2">
                <Stamp dot>NOW FORGING · v 0.9.3</Stamp>
              </div>
              {/* Forge Workshop display: Space Grotesk Bold UPPERCASE
                  with HighlighterMark on emphasis nouns. Replaces the
                  legacy italic-Fraunces-ember signature per DESIGN.md. */}
              <h1 className="font-display-grotesk text-[clamp(40px,4.6vw,64px)] font-bold uppercase leading-[0.98] tracking-[-0.025em] text-parchment max-[720px]:text-[clamp(28px,8vw,36px)]">
                Start with <HighlighterMark>nothing</HighlighterMark>.
                <br />
                Ship with <HighlighterMark>everything</HighlighterMark>.
              </h1>
              <p className="mt-4 max-w-[340px] font-text text-[14px] leading-[1.55] text-bone max-[720px]:hidden">
                A registry of composable skills. Watch a blank screen equip
                itself — nav, type, hero, motion. Install what you need; skip
                what you don&apos;t.
              </p>
              <div className="mt-7 flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ash after:h-px after:flex-1 after:bg-[linear-gradient(90deg,var(--color-border-strong),transparent)] after:content-[''] max-[720px]:hidden">
                Scroll to equip ↓
              </div>
            </div>
            <div className="mt-4 max-[720px]:mt-2">
              <HeroChyron
                ref={chyronRef}
                nameRef={chyronNameRef}
                pctRef={chyronPctRef}
                barFillRef={chyronBarRef}
              />
            </div>
          </div>

          {/* Phone — desktop fits the middle column. Mobile centers it at
              ~70% of the viewport width above the rail. */}
          <div className="max-[720px]:row-start-2 max-[720px]:flex max-[720px]:justify-center">
            <div className="max-[720px]:w-[70%] max-[720px]:max-w-[280px]">
              <PhoneMockup
                phoneRef={phoneRef}
                layerBlankRef={layerBlankRef}
                layerWireRef={layerWireRef}
                layerStyledRef={layerStyledRef}
              />
            </div>
          </div>

          {/* Rail — desktop sits in the right column. Mobile spans full
              width below the phone, capped at ~96px so only 3-ish rows
              show; the auto-scroll keeps the firing row visible. Skill
              chips animate UP out of these rows toward the phone targets. */}
          <div className="max-[720px]:row-start-3 max-[720px]:[--mobile-rail:1]">
            <RepoRail railRef={railRef} listRef={listRef} countRef={countRef} />
          </div>
        </div>
        </div>

        {/* Chip layer */}
        <div
          ref={chipLayerRef}
          className="pointer-events-none absolute inset-0 z-[15] overflow-visible"
        >
          {RAIL_SKILLS.map((s, i) => (
            <div
              key={s.idx}
              ref={(el) => {
                chipRefs.current[i] = el;
              }}
              className="absolute left-0 top-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border border-ember bg-graphite px-2.5 py-[5px] font-mono text-[10px] tracking-[0.02em] text-parchment shadow-[0_12px_40px_-8px_rgb(255_106_26/0.55)] [will-change:transform,opacity]"
              style={{ opacity: 0, transform: "translate(-50%, -50%)" }}
            >
              <span className="h-[5px] w-[5px] rounded-full bg-ember shadow-[0_0_6px_var(--color-ember)]" />
              <span className="font-semibold text-ember">+</span>
              {s.name}
            </div>
          ))}
        </div>

        {/* Final CTA overlay */}
        <div
          ref={finalRef}
          data-on="false"
          className="pointer-events-none absolute left-1/2 top-1/2 z-[32] -translate-x-1/2 -translate-y-1/2 text-center opacity-0 transition-opacity duration-500 data-[on=true]:pointer-events-auto data-[on=true]:opacity-100"
        >
          <div className="flex max-w-[500px] flex-col items-center gap-4 rounded-[4px] border border-[color:var(--color-border-strong)] [background-color:var(--surface-overlay)] px-10 py-8 backdrop-blur-[14px]">
            <div className="font-display-grotesk text-[28px] font-bold uppercase leading-[1.0] tracking-[-0.02em] text-parchment">
              Your product. Your agent.
              <br />
              Fully equipped.
            </div>
            <div className="flex gap-3">
              <EmberLink to="/registry">Browse skills →</EmberLink>
              <EmberLink to="/skills/new" variant="ghost">
                Publish yours
              </EmberLink>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────
   Static fallback for reduced-motion + mobile
   ──────────────────────────────────────────────────────────── */

function StaticHero() {
  const phoneRef = useRef<HTMLDivElement>(null);
  const layerBlankRef = useRef<HTMLDivElement>(null);
  const layerWireRef = useRef<HTMLDivElement>(null);
  const layerStyledRef = useRef<HTMLDivElement>(null);

  // Pre-set the phone to "READY"
  useEffect(() => {
    if (layerBlankRef.current) layerBlankRef.current.style.opacity = "0";
    if (layerWireRef.current) layerWireRef.current.style.opacity = "0";
    if (layerStyledRef.current) {
      layerStyledRef.current.style.opacity = "1";
      layerStyledRef.current.dataset.on = "true";
    }
    if (phoneRef.current) phoneRef.current.dataset.settled = "true";
  }, []);

  return (
    <section
      id="hero"
      className="relative bg-page"
      aria-label="Ornn product overview"
    >
      <div className="relative min-h-screen overflow-hidden">
        <ForgeBackground />
        <ForgeFloor />

        <div className="relative z-10 mx-auto flex max-w-[1280px] flex-col gap-10 px-6 pb-12 pt-14 sm:gap-12 sm:px-8 sm:pb-20 sm:pt-24">
          <div className="grid items-center gap-10 sm:gap-12 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col items-start gap-5 sm:gap-6">
              <Stamp dot>NOW FORGING · v 0.9.3</Stamp>
              {/* Static / reduced-motion hero — same Forge Workshop display */}
              <h1 className="font-display-grotesk text-[clamp(40px,4.6vw,64px)] font-bold uppercase leading-[0.98] tracking-[-0.025em] text-parchment max-[720px]:text-[clamp(28px,8vw,36px)]">
                Start with <HighlighterMark>nothing</HighlighterMark>.
                <br />
                Ship with <HighlighterMark>everything</HighlighterMark>.
              </h1>
              <p className="max-w-[440px] font-text text-[14px] leading-[1.55] text-bone sm:text-base">
                A registry of composable skills. Install what you need; skip what
                you don&apos;t.
              </p>
              <div className="flex flex-wrap gap-3">
                <EmberLink to="/registry">Browse skills →</EmberLink>
                <EmberLink to="/skills/new" variant="ghost">
                  Publish yours
                </EmberLink>
              </div>
            </div>

            <div className="mx-auto w-full max-w-[240px] sm:max-w-[290px]">
              <PhoneMockup
                phoneRef={phoneRef}
                layerBlankRef={layerBlankRef}
                layerWireRef={layerWireRef}
                layerStyledRef={layerStyledRef}
              />
            </div>
          </div>

          <SkillMarquee />
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────
   Skill marquee — horizontal-scrolling brand flavor below the
   phone in StaticHero (mobile + reduced-motion). Reuses the
   `marquee` keyframe from neon.css and renders the list twice
   so the loop is seamless.
   ──────────────────────────────────────────────────────────── */

function SkillMarquee() {
  const items = [...RAIL_SKILLS, ...RAIL_SKILLS];
  return (
    <div
      aria-hidden="true"
      className="relative w-full overflow-hidden border-y border-[color:var(--color-border-subtle)] py-3 [background-color:var(--surface-rail)]"
    >
      <div className="flex w-max gap-2 [animation:marquee_38s_linear_infinite]">
        {items.map((s, i) => (
          <span
            key={`${s.idx}-${i}`}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[3px] border border-[rgb(255_106_26/0.28)] bg-[rgb(255_106_26/0.06)] px-2.5 py-[5px] font-mono text-[10px] tracking-[0.02em] text-parchment"
          >
            <span className="h-[5px] w-[5px] rounded-full bg-ember shadow-[0_0_6px_var(--color-ember)]" />
            <span className="font-medium text-ember">+</span>
            {s.name}
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 [background-image:linear-gradient(90deg,var(--color-page),transparent)]" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 [background-image:linear-gradient(270deg,var(--color-page),transparent)]" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Background pieces
   ──────────────────────────────────────────────────────────── */

function ForgeBackground() {
  return (
    <div aria-hidden="true" className="absolute inset-0 z-[1] overflow-hidden">
      {/* Base ember-warmed gradient (ember radial + page tone) */}
      <div className="absolute inset-0 [background-image:var(--gradient-hero)]" />

      {/* Blueprint drafting grid — subtle paper-feel, fades into the
          ForgeFloor's grid so they blend seamlessly. */}
      <div className="absolute inset-0 [background-image:var(--pattern-grid)] [background-size:var(--pattern-grid-size)] opacity-60 [mask-image:linear-gradient(180deg,black_0%,black_45%,transparent_72%)]" />

      {/* Workshop diagonal hatch — very faint, adds tactile drafting-paper
          texture so the upper canvas isn't a flat field. Strongest in
          light mode where the plain wall is most visible. */}
      <div className="absolute inset-0 opacity-[0.06] [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_22px,var(--color-strong)_22px,var(--color-strong)_23px)] [mask-image:radial-gradient(ellipse_70%_55%_at_50%_25%,black_35%,transparent)]" />

      {/* Corner registration marks — printer's crop marks, drafting feel.
          On mobile the brackets sit closer to the viewport edge (12px)
          so they read as page-corner marks rather than content-frame
          marks colliding with the stamp at the start of the px-6 gutter. */}
      <span className="pointer-events-none absolute left-3 top-3 inline-block h-2.5 w-2.5 sm:left-6 sm:top-6">
        <span className="absolute left-0 top-0 h-px w-full bg-ember opacity-80" />
        <span className="absolute left-0 top-0 h-full w-px bg-ember opacity-80" />
      </span>
      <span className="pointer-events-none absolute right-3 top-3 inline-block h-2.5 w-2.5 sm:right-6 sm:top-6">
        <span className="absolute right-0 top-0 h-px w-full bg-ember opacity-80" />
        <span className="absolute right-0 top-0 h-full w-px bg-ember opacity-80" />
      </span>
    </div>
  );
}

function ForgeFloor() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 left-0 right-0 z-[1] h-[45%]"
    >
      <div className="absolute inset-0 [transform-origin:bottom] [transform:perspective(700px)_rotateX(62deg)] [mask-image:linear-gradient(180deg,transparent_10%,black)] [background-image:var(--gradient-hero-floor)] [background-size:80px_80px]" />
    </div>
  );
}

// Suppress unused-import warning for the alias — kept for future motion.path use.
void motion;
