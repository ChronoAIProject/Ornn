/**
 * LandingPage — public marketing surface at `/`.
 *
 * Composition root for the editorial-forge landing. Owns the page-level
 * background and font; everything inside is driven by Tailwind utilities
 * backed by the `--color-*` and `--font-display` tokens declared in
 * styles/neon.css. The hero scroll-scrub lives in `HeroStage`.
 *
 * Routed bare (no RootLayout) so the 820vh sticky hero owns its scroll.
 */
import { LandingNav } from "@/pages/landing/LandingNav";
import { HeroStage } from "@/pages/landing/HeroStage";
import { WhyOrnnSection } from "@/pages/landing/WhyOrnnSection";
import { InstallEverywhereSection } from "@/pages/landing/InstallEverywhereSection";
import { FeaturedSkillsSection } from "@/pages/landing/FeaturedSkillsSection";
import { VSComparisonSection } from "@/pages/landing/VSComparisonSection";
import { PublishSection } from "@/pages/landing/PublishSection";
import { LandingFooter } from "@/pages/landing/LandingFooter";
import { SectionRule } from "@/pages/landing/HammeredDivider";
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
      <LandingNav />
      <main>
        <HeroStage />
        <SectionRule num="§ 001" label="WHY ORNN" />
        <WhyOrnnSection />
        <SectionRule num="§ 002" label="INSTALL ANYWHERE" />
        <InstallEverywhereSection />
        <SectionRule num="§ 003" label="FROM THE FORGE" />
        <FeaturedSkillsSection />
        <SectionRule num="§ 004" label="ORNN VS." />
        <VSComparisonSection />
        <SectionRule num="§ 005" label="FOR MAKERS" />
        <PublishSection />
      </main>
      <LandingFooter />
    </div>
  );
}
