/**
 * Skills Showcase Section Component.
 * Displays a grid of 3 featured skill cards with staggered entrance animations.
 * @module pages/landing/SkillsShowcase
 */

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

interface ShowcaseSkill {
  icon: React.ReactNode;
  title: string;
  description: string;
  version: string;
}

const SHOWCASE_SKILLS: ShowcaseSkill[] = [
  {
    icon: <CodeIcon />,
    title: "Code Execution",
    description:
      "Execute Python, JavaScript, and TypeScript code in isolated sandboxes with full I/O support.",
    version: "v2.1.0",
  },
  {
    icon: <SearchIcon />,
    title: "Web Search",
    description:
      "Search the web with structured queries and return parsed, LLM-ready results.",
    version: "v1.4.2",
  },
  {
    icon: <DatabaseIcon />,
    title: "Data Pipeline",
    description:
      "Transform, validate, and route data between services with schema enforcement.",
    version: "v3.0.1",
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: i * 0.1, ease: "easeOut" },
  }),
};

export function SkillsShowcase() {
  const { t } = useTranslation();

  return (
    <section id="skills" className="px-4 py-20">
      <div className="max-w-[1280px] mx-auto">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="mb-12 text-center"
        >
          <h2 className="font-heading text-2xl sm:text-3xl font-bold text-text-primary tracking-wide mb-3">
            {t("landing.showcaseTitle")}
          </h2>
          <p className="font-body text-text-muted max-w-lg mx-auto">
            {t("landing.showcaseDesc")}
          </p>
        </motion.div>

        {/* Skills grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SHOWCASE_SKILLS.map((skill, i) => (
            <motion.div
              key={skill.title}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-50px" }}
              whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
              className="glass glass-hover rounded-xl p-6 transition-all duration-200"
            >
              {/* Icon */}
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan">
                {skill.icon}
              </div>

              {/* Title */}
              <h3 className="font-heading text-lg font-semibold text-text-primary mb-2">
                {skill.title}
              </h3>

              {/* Description */}
              <p className="font-body text-sm text-text-muted leading-relaxed mb-4">
                {skill.description}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-bg-elevated px-3 py-1 font-mono text-xs text-text-muted">
                  {skill.version}
                </span>
                <span className="font-body text-sm font-semibold text-neon-cyan transition-colors hover:underline cursor-pointer">
                  {t("landing.viewDocs")}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Code bracket icon */
function CodeIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
      />
    </svg>
  );
}

/** Search icon */
function SearchIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      />
    </svg>
  );
}

/** Database icon */
function DatabaseIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
      />
    </svg>
  );
}
