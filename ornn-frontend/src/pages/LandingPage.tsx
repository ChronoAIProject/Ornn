/**
 * Landing Page.
 * Marketing-quality entry point for unauthenticated users.
 * Composes hero, skills showcase, framework section, and footer.
 * @module pages/LandingPage
 */

import { LandingNavbar } from "./landing/LandingNavbar";
import { HeroSection } from "./landing/HeroSection";
import { SkillsShowcase } from "./landing/SkillsShowcase";
import { FrameworkSection } from "./landing/FrameworkSection";
import { LandingFooter } from "./landing/LandingFooter";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-bg-deep bg-grid">
      <LandingNavbar />
      <main>
        <HeroSection />
        <SkillsShowcase />
        <FrameworkSection />
      </main>
      <LandingFooter />
    </div>
  );
}
