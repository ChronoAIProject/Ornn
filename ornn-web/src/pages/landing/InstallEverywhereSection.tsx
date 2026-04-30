import { useTranslation } from "react-i18next";
import { AnimatedTerminal } from "./AnimatedTerminal";
import { PlatformCard } from "./PlatformCard";
import { BlueprintGrid } from "./BlueprintGrid";
import { HighlighterMark } from "./HighlighterMark";

interface Platform {
  num: string;
  name: string;
  path: string;
  /** Status i18n key suffix — landing.install.statusLive / statusCompatible. */
  statusKey: "statusLive" | "statusCompatible";
}

const PLATFORMS: Platform[] = [
  { num: "01", name: "Claude Code", path: "~/.claude/skills/", statusKey: "statusLive" },
  { num: "02", name: "Cursor", path: ".cursor/rules/*.mdc", statusKey: "statusCompatible" },
  { num: "03", name: "Codex", path: "AGENTS.md", statusKey: "statusCompatible" },
  { num: "04", name: "Antigravity", path: ".antigravity/", statusKey: "statusCompatible" },
];

export function InstallEverywhereSection() {
  const { t } = useTranslation();
  return (
    <section id="install" className="relative scroll-mt-16 overflow-hidden py-20 sm:py-32">
      <BlueprintGrid />
      <div className="relative mx-auto max-w-[1280px] px-6 sm:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="font-display-grotesk text-[clamp(36px,4vw,56px)] font-bold uppercase leading-[0.98] tracking-[-0.025em] text-parchment">
              {t("landing.install.headlineLine1Start")}{" "}
              <HighlighterMark variant="gold">
                {t("landing.install.headlineLine1Highlight")}
              </HighlighterMark>
              {t("landing.install.headlineLine1End")}
              <br />
              {t("landing.install.headlineLine2")}
            </h2>
            <p className="mt-6 max-w-[440px] text-[15px] leading-[1.6] text-bone">
              {t("landing.install.body")}
            </p>
            <div className="mt-8">
              <AnimatedTerminal />
            </div>
          </div>

          <div>
            <div className="mb-4 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-meta">
              {t("landing.install.surfacesLabel")}
            </div>
            <div className="grid grid-cols-1 gap-px border border-[color:var(--color-border-subtle)] bg-[color:var(--color-border-subtle)] sm:grid-cols-2">
              {PLATFORMS.map((p) => (
                <PlatformCard
                  key={p.num}
                  num={p.num}
                  name={p.name}
                  path={p.path}
                  status={t(`landing.install.${p.statusKey}`)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
