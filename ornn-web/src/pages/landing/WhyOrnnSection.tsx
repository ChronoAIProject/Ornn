import { BlueprintGrid, RegMark } from "./BlueprintGrid";
import { HighlighterMark } from "./HighlighterMark";

/**
 * "Why ornn" — three editorial pillars under the hero.
 */
export function WhyOrnnSection() {
  return (
    <section className="relative overflow-hidden">
      <BlueprintGrid />
      <div className="relative mx-auto max-w-[1280px] px-6 sm:px-8">
        <div className="pb-8 pt-8 sm:pb-10 sm:pt-12">
          <h2 className="max-w-[900px] font-display-grotesk text-[clamp(36px,5.4vw,72px)] font-bold uppercase leading-[0.98] tracking-[-0.025em] text-parchment">
            Stop copy-pasting prompts.
            <br />
            Install <HighlighterMark>skills</HighlighterMark> like packages.
          </h2>
        </div>

        <div className="grid grid-cols-1 border-y border-[color:var(--color-border-subtle)] md:grid-cols-3">
          <Pillar
            num="I"
            title={
              <>
                Pull, <HighlighterMark>don&apos;t</HighlighterMark>
                <br />
                paste.
              </>
            }
            body={
              <>
                Skills live on a versioned, audited registry — not in Slack
                threads or random gists. Pull on demand from inside your agent
                via{" "}
                <code className="rounded-[2px] bg-iron px-1.5 py-0.5 font-mono text-xs text-molten">
                  ornn-search-and-run
                </code>
                .
              </>
            }
            proof="// versioned · audited · agent-ready"
            border
          />
          <Pillar
            num="II"
            title={
              <>
                Generate skills
                <br />
                <HighlighterMark>from a prompt</HighlighterMark>.
              </>
            }
            body={
              <>
                Describe the skill in plain English;{" "}
                <code className="rounded-[2px] bg-iron px-1.5 py-0.5 font-mono text-xs text-molten">
                  ornn-build
                </code>{" "}
                drafts a working SKILL.md you can iterate on, sandbox, and
                publish to the registry.
              </>
            }
            proof="// ornn-build is itself a skill on the registry"
            border
          />
          <Pillar
            num="III"
            title={
              <>
                Portable by{" "}
                <HighlighterMark>format</HighlighterMark>.
              </>
            }
            body={
              <>
                Platform-agnostic skill format with a sandbox playground (Node +
                Python) before you ship. NyxID-gated for anything that needs
                auth.
              </>
            }
            proof="// chrono-sandbox · nyxid · audited"
          />
        </div>
      </div>
    </section>
  );
}

function Pillar({
  num,
  title,
  body,
  proof,
  border = false,
}: {
  num: string;
  title: React.ReactNode;
  body: React.ReactNode;
  proof: string;
  border?: boolean;
}) {
  return (
    <div
      className={`relative bg-page/40 px-6 py-10 backdrop-blur-[1px] sm:px-10 sm:py-14 ${
        border
          ? "md:border-r md:border-[color:var(--color-border-subtle)]"
          : ""
      } [&:not(:last-child)]:border-b [&:not(:last-child)]:border-[color:var(--color-border-subtle)] md:[&:not(:last-child)]:border-b-0`}
    >
      <RegMark position="tl" />
      <RegMark position="br" />
      <div className="flex items-baseline gap-3">
        <div className="font-display text-sm tracking-[0.1em] text-ember">
          {num}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-meta">
          Pillar · {num}
        </div>
      </div>
      <h3 className="mb-4 mt-5 font-display-grotesk text-[32px] font-bold uppercase leading-[1.0] tracking-[-0.02em] text-parchment">
        {title}
      </h3>
      <p className="text-sm leading-[1.6] text-bone">{body}</p>
      <div className="mt-5 border-t border-dashed border-[color:var(--color-border-strong)] pt-4 font-mono text-[11px] tracking-[0.04em] text-meta">
        {proof}
      </div>
    </div>
  );
}
