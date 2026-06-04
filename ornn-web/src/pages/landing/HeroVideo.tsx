import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { EmberLink } from "./EmberButton";

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
 * HeroVideo — the full-bleed landing hero (#840).
 *
 * Replaces the scroll-scrub `HeroStage` narrative with a single autoplaying,
 * muted, looping background intro video that fills the viewport. The video is
 * decorative (`aria-hidden`) — the burned-in captions carry the message — so
 * the only interactive content is the CTA pair.
 *
 * Reduced-motion users get the static poster frame instead of the video.
 *
 * Caption-safety (AC4): the source video burns its captions into the
 * lower-center band, so the CTA + scrim live at the TOP-LEFT (clear of the
 * Navbar) and the scrim is a top-down gradient. A bottom CTA/scrim would sit
 * on top of — and an ember-tinted scrim would muddy — the orange caption text.
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
      className="relative h-[100svh] min-h-[640px] w-full overflow-hidden bg-page"
    >
      {reduced ? (
        <img
          src="/ornn-intro-poster.jpg"
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
          poster="/ornn-intro-poster.jpg"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        >
          <source src="/ornn-intro.mp4" type="video/mp4" />
        </video>
      )}

      {/* Top scrim — local to the CTA corner, never the full frame, so the
          lower-center burned-in captions stay legible. Top-down page-tone
          gradient anchors the CTA against the bright forge ceiling + Navbar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-56 bg-gradient-to-b from-[var(--color-page)] to-transparent opacity-90"
      />

      {/* CTA — top-left, below the Navbar, clear of the caption band. The
          local plate (overlay surface + blur + strong border, the same
          vocabulary as HeroStage's final-CTA overlay) keeps the labels above
          WCAG AA regardless of the decorative video frame behind them — the
          top scrim alone can't guarantee contrast once the CTA outgrows it. */}
      <div className="absolute left-8 top-24 z-10 flex gap-3 rounded-[4px] border border-[color:var(--color-border-strong)] [background-color:var(--surface-overlay)] p-3 backdrop-blur-[14px] sm:left-12 sm:top-28">
        <EmberLink to="/registry">{t("landing.browseSkills")}</EmberLink>
        <EmberLink to="/skills/new" variant="ghost">
          {t("landing.publishYours")}
        </EmberLink>
      </div>
    </section>
  );
}
