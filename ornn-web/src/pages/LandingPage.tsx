/**
 * LandingPage — public marketing surface at `/`.
 *
 * Composition root for the editorial-forge landing. Owns the page-level
 * background and font; everything inside is driven by Tailwind utilities
 * backed by the `--color-*` and `--font-display` tokens declared in
 * styles/neon.css. The hero scroll-scrub lives in `HeroStage`.
 *
 * Routed bare (no RootLayout) so the 820vh sticky hero owns its scroll.
 *
 * Pre-launch trim (#324): the lower marketing sections (Why / Install /
 * Featured / VS / Publish) are unmounted in favor of a hero-only
 * landing. The components still live in `pages/landing/` so we can
 * remount selectively as the message stabilizes; nothing here is
 * deleted.
 */
import { LandingNav } from "@/pages/landing/LandingNav";
import { HeroStage } from "@/pages/landing/HeroStage";
import { LandingFooter } from "@/pages/landing/LandingFooter";
import { LandingChrome } from "@/pages/landing/LandingChrome";
import { AnnouncementPopup } from "@/pages/landing/AnnouncementPopup";

export function LandingPage() {
  return (
    <div className="landing-route min-h-screen bg-page font-text text-body antialiased">
      {/* Forge Workshop chrome — page-corner registration marks + drafting
          overlay (light-mode page-edge dim rulers). Scoped to .landing-route
          so app-shell pages do NOT inherit. */}
      <LandingChrome />
      {/* SVG turbulence filter for <HighlighterMark> is mounted once at
          the app root in App.tsx so app-shell pages share it. */}
      <LandingNav />
      <main>
        <HeroStage />
      </main>
      <LandingFooter />
      <AnnouncementPopup />
    </div>
  );
}
