/**
 * LandingPage — public marketing surface at `/`.
 *
 * Composition root for the editorial-forge landing. Owns the page-level
 * background and font; everything inside is driven by Tailwind utilities
 * backed by the `--color-*` and `--font-display` tokens declared in
 * styles/neon.css.
 *
 * Hero (#840): the landing now leads with `HeroVideo` — a full-bleed,
 * autoplaying, muted, looping background intro video (static poster under
 * reduced-motion) with a top-left CTA pair. The prior scroll-scrub
 * `HeroStage` is retained in `pages/landing/` (and stays compilable) but is
 * no longer mounted; it can be remounted if we revisit the scrub narrative.
 *
 * Pre-launch trim (#324): the lower marketing sections (Why / Install /
 * Featured / VS / Publish) are unmounted in favor of a hero-only
 * landing. The components still live in `pages/landing/` so we can
 * remount selectively as the message stabilizes; nothing here is
 * deleted.
 */
import { Navbar } from "@/components/layout/Navbar";
import { HeroVideo } from "@/pages/landing/HeroVideo";
import { LandingFooter } from "@/pages/landing/LandingFooter";
import { LandingChrome } from "@/pages/landing/LandingChrome";

export function LandingPage() {
  return (
    <div className="landing-route min-h-screen bg-page font-text text-body antialiased">
      {/* Forge Workshop chrome — page-corner registration marks + drafting
          overlay (light-mode page-edge dim rulers). Scoped to .landing-route
          so app-shell pages do NOT inherit. */}
      <LandingChrome />
      {/* SVG turbulence filter for <HighlighterMark> is mounted once at
          the app root in App.tsx so app-shell pages share it. */}
      <Navbar showGetStartedCta />
      <main>
        <HeroVideo />
      </main>
      <LandingFooter />
    </div>
  );
}
