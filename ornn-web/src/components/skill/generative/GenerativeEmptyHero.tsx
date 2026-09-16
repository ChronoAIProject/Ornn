/**
 * Empty-state hero for CreateSkillGenerativePage (#1242 decomposition).
 *
 * Centered welcome flag — eyebrow + headline + lead sentence + three
 * prompt-starter chips + a drawer-discovery footer note. Mirrors
 * PlaygroundEmptyHero so the two chat surfaces read as one family.
 *
 * Stateless — the parent owns the click handler; the starters are
 * localized here because they are static copy.
 *
 * @module components/skill/generative/GenerativeEmptyHero
 */

import { useTranslation } from "react-i18next";

export interface PromptStarter {
  label: string;
  body: string;
}

type TFunc = ReturnType<typeof useTranslation>["t"];

function defaultPromptStarters(t: TFunc): PromptStarter[] {
  return [
    {
      label: t("generative.starter1Label", "Slack notifier"),
      body: t(
        "generative.starter1Body",
        "Build a skill that posts a formatted message to a Slack channel via webhook. Take channel + message as inputs.",
      ),
    },
    {
      label: t("generative.starter2Label", "Fetch GitHub PRs"),
      body: t(
        "generative.starter2Body",
        "Build a skill that lists open pull requests for a given GitHub repo, sorted by latest activity.",
      ),
    },
    {
      label: t("generative.starter3Label", "CSV → JSON"),
      body: t(
        "generative.starter3Body",
        "Build a skill that reads a CSV file and outputs a JSON array, inferring types per column.",
      ),
    },
  ];
}

export interface GenerativeEmptyHeroProps {
  onStarterClick: (body: string) => void;
}

export function GenerativeEmptyHero({ onStarterClick }: GenerativeEmptyHeroProps) {
  const { t } = useTranslation();
  const starters = defaultPromptStarters(t);

  return (
    <div className="flex h-full flex-col items-center justify-center py-8">
      <div className="w-full space-y-6 text-center">
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.20em] text-meta">
            {t("generative.eyebrow", "Generative skill builder")}
          </div>
          <h2 className="font-display text-3xl font-semibold leading-[1.15] tracking-tight text-strong">
            {t("generative.heroTitle", "Describe a skill. Build it.")}
          </h2>
          <p className="font-text text-[15px] leading-relaxed text-body">
            {t(
              "generative.heroSubtitle",
              "Tell the model what the skill should do. It drafts the package; you iterate; you save.",
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {starters.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onStarterClick(s.body)}
              className="group flex flex-col items-start gap-1 rounded-xl border border-subtle bg-card/60 px-3.5 py-3 text-left transition-all hover:border-accent/60 hover:bg-card"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                {s.label}
              </span>
              <span className="line-clamp-2 font-text text-[13px] leading-snug text-body">
                {s.body}
              </span>
            </button>
          ))}
        </div>

        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta/70">
          {t(
            "generative.drawerHint",
            "Package preview + Save on the right edge",
          )}
        </p>
      </div>
    </div>
  );
}
