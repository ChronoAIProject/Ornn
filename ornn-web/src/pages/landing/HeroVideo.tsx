import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { EmberLink } from "./EmberButton";
import { LifecycleRing } from "./LifecycleRing";

// Vite-managed (content-hashed) hero assets. Hashed URLs make every asset
// swap self-cache-busting — nginx serves images/fonts with a 1y immutable
// Cache-Control, so replacing bytes at a stable /public URL would leave
// returning visitors on the stale file.
import introPoster from "@/assets/ornn-intro-poster.jpg";
import introVideo from "@/assets/ornn-intro.mp4";

/**
 * Subscribe to the OS "reduce motion" preference and re-render on change.
 *
 * Deliberately NOT framer-motion's `useReducedMotion` — the unit test stubs
 * `window.matchMedia`, and a hand-rolled `useSyncExternalStore` against that
 * MediaQueryList is what lets the test toggle `matches` deterministically.
 * The server snapshot returns `false` so SSR / non-browser renders default to
 * the motion (video) branch.
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/**
 * HeroVideo — the full-bleed landing hero (#840, #896).
 *
 * Replaces the scroll-scrub `HeroStage` narrative with a single autoplaying,
 * muted, looping background intro video that fills the viewport. The video is
 * pure animation — no caption layer (#896) — and decorative (`aria-hidden`),
 * so the only interactive (and only textual) content is the CTA pair.
 *
 * Reduced-motion users get the static poster frame instead of the video.
 *
 * The asset is true 16:9 (1920x1080@60, H.264 High@L4.2 — kept ≤ L5.1 so
 * phones can hardware-decode it, see #870). `object-cover` scales/crops it to
 * any viewport ratio, so real content pixels fill the screen edge-to-edge —
 * there are no baked-in letterbox bars (unlike the pre-#896 2.4:1 frame).
 */
export function HeroVideo() {
  const reduced = usePrefersReducedMotion();
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Defensive: some browsers ignore the `muted` attribute on hydration and
  // then refuse to autoplay. Force the property so autoplay is honored.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = true;
  }, []);

  return (
    <section
      aria-label={t("aria.productOverview", { brand: "Ornn" })}
      className="relative h-[100svh] w-full overflow-hidden bg-page"
    >
      {reduced ? (
        <img
          src={introPoster}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={introPoster}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        >
          <source src={introVideo} type="video/mp4" />
        </video>
      )}

      {/* Top scrim — local to the CTA corner, never the full frame, so the
          animation stays unobscured. Top-down page-tone gradient anchors the
          CTA against the bright forge ceiling + Navbar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-56 bg-gradient-to-b from-[var(--color-page)] to-transparent opacity-90"
      />

      {/* CTA — top-left, below the Navbar. The local plate (overlay surface +
          blur + strong border, the same vocabulary as HeroStage's final-CTA
          overlay) keeps the labels above WCAG AA regardless of the decorative
          video frame behind them — the top scrim alone can't guarantee
          contrast once the CTA outgrows it. */}
      <div className="absolute left-8 top-24 z-10 flex gap-3 sm:left-12 sm:top-28">
        <EmberLink to="/registry">{t("landing.browseSkills")}</EmberLink>
        <EmberLink to="/skills/new" variant="ghost">
          {t("landing.publishYours")}
        </EmberLink>
      </div>

      {/* Skill-lifecycle orbital ring — interactive layer over the video.
          Itself pointer-events-none except its nodes/card, so the looping
          video and the CTA plate above stay fully interactive. */}
      <LifecycleRing />
    </section>
  );
}
