/**
 * Empty-state hero for PlaygroundPage (#453).
 *
 * ChatGPT-style centered welcome flag: skill name eyebrow + headline +
 * lead sentence (swaps to an env-vars-first message when the skill
 * needs runtime vars that aren't filled yet) + three suggestion chips
 * + a drawer-discovery footer note. Disabled state on the chips
 * mirrors the chat-input lock so users see the same gate from both
 * surfaces.
 *
 * Stateless — the parent owns the starters list + click handler +
 * envIncomplete flag.
 *
 * @module components/playground/PlaygroundEmptyHero
 */

import { useTranslation } from "react-i18next";
import type { PromptStarter } from "./PlaygroundHelpers";

export interface PlaygroundEmptyHeroProps {
  skillName: string | null;
  envIncomplete: boolean;
  starters: PromptStarter[];
  onStarterClick: (body: string) => void;
}

export function PlaygroundEmptyHero({
  skillName,
  envIncomplete,
  starters,
  onStarterClick,
}: PlaygroundEmptyHeroProps) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center py-8">
      <div className="w-full space-y-6 text-center">
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.20em] text-meta">
            {skillName}
          </div>
          <h2 className="font-display text-3xl font-semibold leading-[1.15] tracking-tight text-strong">
            {t("playground.heroTitle", "Probe the skill.")}
          </h2>
          <p className="font-text text-[15px] leading-relaxed text-body">
            {envIncomplete
              ? t(
                  "playground.heroEnvFirst",
                  "Set the runtime env vars in the Env drawer on the right, then start chatting.",
                )
              : t(
                  "playground.heroSubtitle",
                  "Ask anything about {{name}}, or have it run with sample input.",
                  { name: skillName },
                )}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {starters.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onStarterClick(s.body)}
              disabled={envIncomplete}
              className="group flex flex-col items-start gap-1 rounded-xl border border-subtle bg-card/60 px-3.5 py-3 text-left transition-all hover:border-accent/60 hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
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
            "playground.drawerHint",
            "Skill · Env · Package on the right edge",
          )}
        </p>
      </div>
    </div>
  );
}
