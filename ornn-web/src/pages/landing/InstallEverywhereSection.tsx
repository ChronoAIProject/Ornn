import { AnimatedTerminal } from "./AnimatedTerminal";
import { PlatformCard } from "./PlatformCard";
import { BlueprintGrid } from "./BlueprintGrid";
import { HighlighterMark } from "./HighlighterMark";

const PLATFORMS = [
  { num: "01", name: "Claude Code", path: "~/.claude/skills/", status: "live today" },
  { num: "02", name: "Cursor", path: ".cursor/rules/*.mdc", status: "format-compatible" },
  { num: "03", name: "Codex", path: "AGENTS.md", status: "format-compatible" },
  { num: "04", name: "Antigravity", path: ".antigravity/", status: "format-compatible" },
];

export function InstallEverywhereSection() {
  return (
    <section id="install" className="relative scroll-mt-16 overflow-hidden py-20 sm:py-32">
      <BlueprintGrid />
      <div className="relative mx-auto max-w-[1280px] px-6 sm:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="font-display-grotesk text-[clamp(36px,4vw,56px)] font-bold uppercase leading-[0.98] tracking-[-0.025em] text-parchment">
              One <HighlighterMark variant="gold">format</HighlighterMark>.
              <br />
              Every agent.
            </h2>
            <p className="mt-6 max-w-[440px] text-[15px] leading-[1.6] text-bone">
              Skills ship as plain markdown with manifest metadata — portable
              by design, with no glue code between runtimes. Today they pull
              into Claude Code; the format is open and agent-agnostic.
            </p>
            <div className="mt-8">
              <AnimatedTerminal />
            </div>
          </div>

          <div>
            <div className="mb-4 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-meta">
              Targeted agent surfaces
            </div>
            <div className="grid grid-cols-1 gap-px border border-[color:var(--color-border-subtle)] bg-[color:var(--color-border-subtle)] sm:grid-cols-2">
              {PLATFORMS.map((p) => (
                <PlatformCard key={p.num} {...p} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
