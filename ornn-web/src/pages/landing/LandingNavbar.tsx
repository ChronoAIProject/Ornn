/**
 * Landing Page Navbar Component.
 * Simplified navigation bar for unauthenticated landing page.
 * Glass morphism with forge-themed branding.
 * @module pages/landing/LandingNavbar
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const NAV_LINKS = [
  { labelKey: "landing.navRegistry", href: "/registry" },
  { labelKey: "landing.navDocs", href: "/docs" },
] as const;

export function LandingNavbar() {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="glass fixed top-0 right-0 left-0 z-40 border-b border-neon-cyan/10">
      <div className="flex h-28 items-center justify-between px-6 sm:px-10">
        {/* Logo */}
        <Link to="/" className="flex items-center shrink-0">
          <img src="/logo.svg" alt="ORNN" className="h-16 w-auto" />
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.labelKey}
              to={link.href}
              className="font-body text-base font-semibold uppercase tracking-wider text-text-muted transition-colors hover:text-text-primary"
            >
              {t(link.labelKey)}
            </Link>
          ))}
        </div>

        {/* CTA */}
        <div className="flex items-center gap-4">
          <Link
            to="/login"
            className="rounded-lg border border-neon-cyan/50 bg-neon-cyan/10 px-6 py-2.5 font-body text-base font-semibold text-neon-cyan transition-all duration-200 hover:bg-neon-cyan/20 hover:border-neon-cyan hover:shadow-[0_0_15px_rgba(255,107,0,0.3)]"
          >
            {t("landing.getStarted")}
          </Link>

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden flex h-10 w-10 items-center justify-center rounded-lg border border-neon-cyan/30 bg-bg-surface/50 text-text-muted transition-colors hover:text-neon-cyan cursor-pointer"
            aria-label="Toggle menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden glass border-t border-neon-cyan/10 px-4 py-4 space-y-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.labelKey}
              to={link.href}
              onClick={() => setMobileOpen(false)}
              className="block rounded-lg px-4 py-2 font-body text-sm text-text-muted hover:bg-neon-cyan/5 hover:text-text-primary transition-colors"
            >
              {t(link.labelKey)}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
