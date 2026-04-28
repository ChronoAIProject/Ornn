import { BlueprintGrid } from "./BlueprintGrid";

type Row = {
  competitor: string;
  them: string;
  us: React.ReactNode;
  highlight?: boolean;
  themItalic?: boolean;
};

const ROWS: Row[] = [
  {
    competitor: "Composio",
    them: "Ships pre-built tools Composio owns.",
    us: (
      <>
        Hosts skills <strong className="font-medium text-ember">anyone</strong>{" "}
        creates — you, your team, the world.
      </>
    ),
  },
  {
    competitor: "LangChain Hub",
    them: "Shares prompt templates.",
    us: (
      <>
        Shares{" "}
        <strong className="font-medium text-ember">executable skills</strong>{" "}
        with a sandboxed runtime and audited, versioned releases.
      </>
    ),
  },
  {
    competitor: "Anthropic Skills",
    them: "Work only inside Claude.",
    us: (
      <>
        <strong className="font-medium text-ember">Open format</strong> — not
        Claude-locked. Skills travel with the agent that consumes them.
      </>
    ),
  },
  {
    competitor: "ORNN",
    them: "Not a runtime — execution happens in the agent.",
    themItalic: true,
    us: (
      <>
        ORNN is the <strong className="font-medium text-ember">registry</strong>
        . It finds, versions, and audits.
      </>
    ),
    highlight: true,
  },
];

export function VSComparisonSection() {
  return (
    <section
      id="compare"
      className="relative scroll-mt-16 overflow-hidden border-t border-[color:var(--color-border-subtle)] py-20 sm:py-32"
    >
      <BlueprintGrid />
      <div className="relative mx-auto max-w-[1280px] px-6 sm:px-8">
        <div className="mb-12 max-w-[760px]">
          <h2 className="font-display text-[clamp(36px,5vw,72px)] font-light leading-none tracking-[-0.03em] text-parchment">
            Not <em className="italic font-normal text-ember">that</em>.{" "}
            <em className="italic font-normal text-ember">This.</em>
          </h2>
          <p className="mt-5 text-[15px] leading-[1.6] text-bone">
            A few things ORNN is often confused with, and what makes it
            different.
          </p>
        </div>

        {/* Mobile: stacked cards */}
        <div className="flex flex-col gap-4 md:hidden">
          {ROWS.map((r) => (
            <div
              key={r.competitor}
              className={`rounded-[3px] border p-5 ${
                r.highlight
                  ? "border-[rgb(255_106_26/0.35)] bg-[rgb(255_106_26/0.04)]"
                  : "border-[color:var(--color-border-subtle)]"
              }`}
            >
              <div
                className={`font-display text-[24px] font-light tracking-[-0.015em] ${
                  r.highlight ? "text-ember" : "text-parchment"
                }`}
              >
                {r.competitor}
              </div>
              <div className="mt-3 grid gap-2.5 text-[13px] leading-snug">
                <div>
                  <span className="mr-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-meta">
                    Them
                  </span>
                  <span
                    className={`text-bone ${r.themItalic ? "italic" : ""}`}
                  >
                    {r.them}
                  </span>
                </div>
                <div>
                  <span className="mr-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-meta">
                    Ornn
                  </span>
                  <span className="text-parchment">{r.us}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tablet+: full table */}
        <div className="hidden md:block">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border-b border-[color:var(--color-border-strong)] px-5 pb-3.5 pt-5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-meta">
                  Often confused with
                </th>
                <th className="border-b border-[color:var(--color-border-strong)] px-5 pb-3.5 pt-5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-meta">
                  What they do
                </th>
                <th className="border-b border-[color:var(--color-border-strong)] px-5 pb-3.5 pt-5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-meta">
                  What ORNN does
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr
                  key={r.competitor}
                  className={
                    r.highlight
                      ? "[&>td]:border-y [&>td]:border-y-[rgb(255_106_26/0.25)] [&>td]:bg-[rgb(255_106_26/0.04)]"
                      : ""
                  }
                >
                  <td
                    className={`w-[200px] border-b border-[color:var(--color-border-subtle)] px-5 py-5 align-top font-display text-[22px] font-light tracking-[-0.015em] ${
                      r.highlight ? "text-ember" : "text-parchment"
                    }`}
                  >
                    {r.competitor}
                  </td>
                  <td
                    className={`border-b border-[color:var(--color-border-subtle)] px-5 py-5 align-top text-sm text-bone ${
                      r.themItalic ? "italic" : ""
                    }`}
                  >
                    {r.them}
                  </td>
                  <td className="border-b border-[color:var(--color-border-subtle)] px-5 py-5 align-top text-sm text-parchment">
                    {r.us}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
