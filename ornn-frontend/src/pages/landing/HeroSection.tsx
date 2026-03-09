/**
 * Hero Section Component.
 * Landing page hero with badge, heading, subtitle, and CTA buttons.
 * Features orange radial glow background and staggered entrance animations.
 * @module pages/landing/HeroSection
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";

const STAGGER_DELAY = 0.12;

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-32 pb-24 px-4">
      {/* Orange radial glow background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{ opacity: [0.12, 0.2, 0.12] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[radial-gradient(ellipse,rgba(255,107,0,0.15)_0%,transparent_70%)]"
        />
      </div>

      <div className="relative max-w-4xl mx-auto text-center">
        {/* Badge pill */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="mb-8"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-4 py-1.5 font-body text-sm text-neon-cyan">
            <span className="h-2 w-2 rounded-full bg-neon-cyan animate-pulse" />
            NOW LIVE: REGISTRY V2.0
          </span>
        </motion.div>

        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: STAGGER_DELAY, ease: "easeOut" }}
          className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold tracking-wide leading-tight mb-6"
        >
          <span className="text-text-primary">Forge the Future of </span>
          <span className="text-neon-cyan neon-cyan">AI Capabilities</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: STAGGER_DELAY * 2, ease: "easeOut" }}
          className="font-body text-lg sm:text-xl text-text-muted max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          Ornn is the industry-standard skill registry for AI agents.
          Standardized, verifiable, and executable capabilities for the next
          generation of autonomous intelligence.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: STAGGER_DELAY * 3, ease: "easeOut" }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            to="/login"
            state={{ from: "/" }}
            className="inline-flex items-center gap-2 rounded-lg bg-neon-cyan/15 border border-neon-cyan px-6 py-3 font-body text-base font-semibold text-neon-cyan transition-all duration-200 hover:bg-neon-cyan/25 hover:shadow-[0_0_20px_rgba(255,107,0,0.3)]"
          >
            Explore Skills
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
          <Link
            to="/login"
            state={{ from: "/onboarding" }}
            className="inline-flex items-center gap-2 rounded-lg border border-text-muted/30 bg-bg-surface/50 px-6 py-3 font-body text-base font-semibold text-text-primary transition-all duration-200 hover:border-text-muted/60 hover:bg-bg-elevated"
          >
            Register Agent
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
