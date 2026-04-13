/**
 * Upload Skill Page.
 * Landing page for skill creation with three-mode selection: Guided, Free, Generative.
 * @module pages/UploadSkillPage
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  titleKey: string;
  descKey: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  accentGlow: string;
  bulletsKey: string;
  ctaKey: string;
  route: string;
  variant: "primary" | "secondary";
  delay: number;
}

const MODE_CARDS: ModeCardConfig[] = [
  {
    titleKey: "upload.guidedTitle",
    descKey: "upload.guidedDesc",
    icon: WizardIcon,
    accentColor: "text-neon-cyan",
    accentBg: "bg-neon-cyan/10",
    accentBorder: "border-neon-cyan/30",
    accentGlow: "group-hover:shadow-[0_0_20px_rgba(255,107,0,0.3)]",
    bulletsKey: "upload.guidedBullets",
    ctaKey: "upload.startGuided",
    route: "/skills/new/guided",
    variant: "primary",
    delay: 0.1,
  },
  {
    titleKey: "upload.freeTitle",
    descKey: "upload.freeDesc",
    icon: UploadIcon,
    accentColor: "text-neon-magenta",
    accentBg: "bg-neon-magenta/10",
    accentBorder: "border-neon-magenta/30",
    accentGlow: "group-hover:shadow-[0_0_20px_rgba(255,140,56,0.3)]",
    bulletsKey: "upload.freeBullets",
    ctaKey: "upload.startFree",
    route: "/skills/new/free",
    variant: "secondary",
    delay: 0.2,
  },
  {
    titleKey: "upload.genTitle",
    descKey: "upload.genDesc",
    icon: SparkleIcon,
    accentColor: "text-neon-yellow",
    accentBg: "bg-neon-yellow/10",
    accentBorder: "border-neon-yellow/30",
    accentGlow: "group-hover:shadow-[0_0_20px_rgba(255,184,0,0.3)]",
    bulletsKey: "upload.genBullets",
    ctaKey: "upload.startGen",
    route: "/skills/new/generate",
    variant: "primary",
    delay: 0.3,
  },
];

export function UploadSkillPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2">
      <div className="max-w-5xl mx-auto flex-1 flex flex-col justify-center">
        <p className="font-body text-base text-text-muted text-center mb-6">
          {t("upload.chooseMode")}
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {MODE_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.titleKey}
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
                      {t(card.titleKey)}
                    </h2>

                    <p className="font-body text-text-muted mb-6">
                      {t(card.descKey)}
                    </p>

                    <ul className="text-left space-y-2 mb-6 w-full">
                      {(t(card.bulletsKey, { returnObjects: true }) as string[]).map((bullet) => (
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
                      {t(card.ctaKey)}
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
