/**
 * Upload Skill Page.
 * Landing page for skill creation with three-mode selection: Guided, Free, Generative.
 * @module pages/UploadSkillPage
 */

import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { PageTransition } from "@/components/layout/PageTransition";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/** Wizard icon for guided mode */
function WizardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
      />
    </svg>
  );
}

/** Upload/zip icon for free mode */
function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
      />
    </svg>
  );
}

/** Sparkle/AI icon for generative mode */
function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
      />
    </svg>
  );
}

interface ModeCardConfig {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  accentGlow: string;
  bullets: string[];
  cta: string;
  route: string;
  variant: "primary" | "secondary";
  delay: number;
}

const MODE_CARDS: ModeCardConfig[] = [
  {
    title: "Guided Mode",
    description:
      "Step-by-step wizard that guides you through creating a skill. Perfect for beginners or structured authoring.",
    icon: WizardIcon,
    accentColor: "text-neon-cyan",
    accentBg: "bg-neon-cyan/10",
    accentBorder: "border-neon-cyan/30",
    accentGlow: "group-hover:shadow-[0_0_20px_rgba(255,107,0,0.3)]",
    bullets: [
      "Step-by-step form",
      "Markdown editor with preview",
      "Folder-based file uploads",
      "Full package preview",
    ],
    cta: "Start Guided Mode",
    route: "/skills/new/guided",
    variant: "primary",
    delay: 0.1,
  },
  {
    title: "Free Mode",
    description:
      "Upload a pre-built skill package as a ZIP file. Best for experienced authors with existing skills.",
    icon: UploadIcon,
    accentColor: "text-neon-magenta",
    accentBg: "bg-neon-magenta/10",
    accentBorder: "border-neon-magenta/30",
    accentGlow: "group-hover:shadow-[0_0_20px_rgba(255,140,56,0.3)]",
    bullets: [
      "ZIP file upload",
      "Structure validation",
      "Auto-metadata extraction",
      "Preview before upload",
    ],
    cta: "Start Free Mode",
    route: "/skills/new/free",
    variant: "secondary",
    delay: 0.2,
  },
  {
    title: "Generative Mode",
    description:
      "Describe what you need and let AI generate a complete skill for you. Refine with chat.",
    icon: SparkleIcon,
    accentColor: "text-neon-yellow",
    accentBg: "bg-neon-yellow/10",
    accentBorder: "border-neon-yellow/30",
    accentGlow: "group-hover:shadow-[0_0_20px_rgba(255,184,0,0.3)]",
    bullets: [
      "AI-powered generation",
      "Real-time streaming",
      "Chat refinement",
      "Auto-structured output",
    ],
    cta: "Start Generative Mode",
    route: "/skills/new/generate",
    variant: "primary",
    delay: 0.3,
  },
];

export function UploadSkillPage() {
  const navigate = useNavigate();

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto py-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="neon-cyan mb-4 font-heading text-3xl font-bold tracking-wider text-neon-cyan sm:text-4xl">
            CREATE SKILL
          </h1>
          <p className="font-body text-lg text-text-muted max-w-2xl mx-auto">
            Choose how you want to create your skill. Use the guided wizard,
            upload a ZIP package, or let AI generate one for you.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {MODE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: card.delay }}
              >
                <Card
                  hoverable
                  onClick={() => navigate(card.route)}
                  className="h-full cursor-pointer group"
                >
                  <div className="flex flex-col items-center text-center p-4">
                    <div
                      className={`mb-6 p-4 rounded-2xl ${card.accentBg} border ${card.accentBorder} ${card.accentGlow} transition-all`}
                    >
                      <Icon className={`h-12 w-12 ${card.accentColor}`} />
                    </div>

                    <h2
                      className={`font-heading text-xl ${card.accentColor} mb-3`}
                    >
                      {card.title}
                    </h2>

                    <p className="font-body text-text-muted mb-6">
                      {card.description}
                    </p>

                    <ul className="text-left space-y-2 mb-6 w-full">
                      {card.bullets.map((bullet) => (
                        <li
                          key={bullet}
                          className="flex items-center gap-2 text-sm text-text-muted"
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${card.accentBg.replace("/10", "")}`}
                          />
                          {bullet}
                        </li>
                      ))}
                    </ul>

                    <Button variant={card.variant} className="w-full">
                      {card.cta}
                    </Button>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>

      </div>
      </div>
    </PageTransition>
  );
}
