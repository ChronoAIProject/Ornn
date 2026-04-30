/**
 * Upload Skill Page.
 * Landing page for skill creation with three-mode selection: Guided, Free, Generative.
 * @module pages/UploadSkillPage
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { PageTransition } from "@/components/layout/PageTransition";
import { BackLink } from "@/components/layout/BackLink";
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

/** GitHub mark */
function GitHubMarkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 00-3.64 22.42c.58.11.79-.25.79-.56v-2.16c-3.21.7-3.89-1.37-3.89-1.37-.52-1.32-1.28-1.67-1.28-1.67-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.97.1-.76.4-1.27.73-1.56-2.56-.29-5.26-1.28-5.26-5.72 0-1.26.45-2.3 1.19-3.11-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18.92-.26 1.92-.39 2.9-.39.99 0 1.98.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.85 1.19 3.11 0 4.45-2.7 5.42-5.28 5.71.41.35.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0012 .5z" />
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
    accentColor: "text-accent",
    accentBg: "bg-accent/10",
    accentBorder: "border-accent/30",
    accentGlow: "",
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
    accentColor: "text-accent-support",
    accentBg: "bg-accent-support/10",
    accentBorder: "border-accent-support/30",
    accentGlow: "",
    bulletsKey: "upload.freeBullets",
    ctaKey: "upload.startFree",
    route: "/skills/new/free",
    variant: "primary",
    delay: 0.2,
  },
  {
    titleKey: "upload.genTitle",
    descKey: "upload.genDesc",
    icon: SparkleIcon,
    accentColor: "text-warning",
    accentBg: "bg-warning/10",
    accentBorder: "border-warning/30",
    accentGlow: "",
    bulletsKey: "upload.genBullets",
    ctaKey: "upload.startGen",
    route: "/skills/new/generate",
    variant: "primary",
    delay: 0.3,
  },
  {
    titleKey: "upload.githubTitle",
    descKey: "upload.githubDesc",
    icon: GitHubMarkIcon,
    accentColor: "text-accent",
    accentBg: "bg-accent/10",
    accentBorder: "border-accent/30",
    accentGlow: "",
    bulletsKey: "upload.githubBullets",
    ctaKey: "upload.startGithub",
    route: "/skills/new/from-github",
    variant: "primary",
    delay: 0.4,
  },
];

export function UploadSkillPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <PageTransition>
      <div className="flex flex-col h-full py-2">
      <nav className="mb-2 max-w-5xl w-full mx-auto">
        <BackLink label={t("common.back", "Back")} />
      </nav>
      <div className="max-w-5xl mx-auto flex-1 flex flex-col justify-center">
        <p className="font-text text-base text-meta text-center mb-6">
          {t("upload.chooseMode")}
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
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
                  {/*
                    Inner column is the full card height (h-full) so the
                    Button can use `mt-auto` to pin to the card's bottom.
                    All four cards therefore have their CTAs sitting on
                    exactly the same baseline regardless of whether the
                    description / bullet list above is shorter or longer.
                  */}
                  <div className="flex flex-col items-center text-center p-4 h-full">
                    <div
                      className={`mb-6 p-4 rounded ${card.accentBg} border ${card.accentBorder} ${card.accentGlow} transition-all`}
                    >
                      <Icon className={`h-12 w-12 ${card.accentColor}`} />
                    </div>

                    <h2
                      className={`font-display text-xl ${card.accentColor} mb-3`}
                    >
                      {t(card.titleKey)}
                    </h2>

                    <p className="font-text text-meta mb-6">
                      {t(card.descKey)}
                    </p>

                    <ul className="text-left space-y-2 mb-6 w-full">
                      {(t(card.bulletsKey, { returnObjects: true }) as string[]).map((bullet) => (
                        <li
                          key={bullet}
                          className="flex items-center gap-2 text-sm text-meta"
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${card.accentBg.replace("/10", "")}`}
                          />
                          {bullet}
                        </li>
                      ))}
                    </ul>

                    {/*
                      mt-auto pushes this CTA to the bottom; whitespace-nowrap
                      keeps the text on one line so all four buttons share
                      the same height (no two-line wrapping for the longer
                      "Start Generative Mode" label).
                    */}
                    <Button
                      variant={card.variant}
                      className="w-full mt-auto"
                    >
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
