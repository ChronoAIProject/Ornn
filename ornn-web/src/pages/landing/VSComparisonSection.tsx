import { useTranslation } from "react-i18next";
import { BlueprintGrid } from "./BlueprintGrid";
import { HighlighterMark } from "./HighlighterMark";

interface RowConfig {
  competitor: string;
  themKey: string;
  us: (t: (k: string) => string) => React.ReactNode;
  highlight?: boolean;
  themItalic?: boolean;
}

const ROWS: RowConfig[] = [
  {
    competitor: "Composio",
    themKey: "landing.compare.row1Them",
    us: (t) => (
      <>
        {t("landing.compare.row1UsPrefix")}{" "}
        <strong className="font-medium text-ember">
          {t("landing.compare.row1UsHighlight")}
        </strong>{" "}
        {t("landing.compare.row1UsSuffix")}
      </>
    ),
  },
  {
    competitor: "LangChain Hub",
    themKey: "landing.compare.row2Them",
    us: (t) => (
      <>
        {t("landing.compare.row2UsPrefix")}{" "}
        <strong className="font-medium text-ember">
          {t("landing.compare.row2UsHighlight")}
        </strong>{" "}
        {t("landing.compare.row2UsSuffix")}
      </>
    ),
  },
  {
    competitor: "Anthropic Skills",
    themKey: "landing.compare.row3Them",
    us: (t) => (
      <>
        <strong className="font-medium text-ember">
          {t("landing.compare.row3UsHighlight")}
        </strong>{" "}
        {t("landing.compare.row3UsSuffix")}
      </>
    ),
  },
  {
    competitor: "ORNN",
    themKey: "landing.compare.row4Them",
    themItalic: true,
    us: (t) => (
      <>
        {t("landing.compare.row4UsPrefix")}{" "}
        <strong className="font-medium text-ember">
          {t("landing.compare.row4UsHighlight")}
        </strong>
        {t("landing.compare.row4UsSuffix")}
      </>
    ),
    highlight: true,
  },
];

export function VSComparisonSection() {
  const { t } = useTranslation();
  return (
    <section
      id="compare"
      className="relative scroll-mt-16 overflow-hidden border-t border-[color:var(--color-border-subtle)] py-20 sm:py-32"
    >
      <BlueprintGrid />
      <div className="relative mx-auto max-w-[1280px] px-6 sm:px-8">
        <div className="mb-12 max-w-[760px]">
          <h2 className="font-display-grotesk text-[clamp(36px,4vw,56px)] font-bold uppercase leading-[0.98] tracking-[-0.025em] text-parchment">
            {t("landing.compare.headlineNot")}{" "}
            <HighlighterMark>{t("landing.compare.headlineThat")}</HighlighterMark>
            .{" "}
            <HighlighterMark>{t("landing.compare.headlineThis")}</HighlighterMark>
          </h2>
          <p className="mt-5 text-[15px] leading-[1.6] text-bone">
            {t("landing.compare.subhead")}
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
                className={`font-display-grotesk text-[20px] font-bold uppercase tracking-[-0.015em] ${
                  r.highlight ? "text-ember" : "text-parchment"
                }`}
              >
                {r.competitor}
              </div>
              <div className="mt-3 grid gap-2.5 text-[13px] leading-snug">
                <div>
                  <span className="mr-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-meta">
                    {t("landing.compare.themLabel")}
                  </span>
                  <span
                    className={`text-bone ${r.themItalic ? "italic" : ""}`}
                  >
                    {t(r.themKey)}
                  </span>
                </div>
                <div>
                  <span className="mr-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-meta">
                    {t("landing.compare.usLabel")}
                  </span>
                  <span className="text-parchment">{r.us(t)}</span>
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
                  {t("landing.compare.themHeader")}
                </th>
                <th className="border-b border-[color:var(--color-border-strong)] px-5 pb-3.5 pt-5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-meta">
                  {t("landing.compare.themDescHeader")}
                </th>
                <th className="border-b border-[color:var(--color-border-strong)] px-5 pb-3.5 pt-5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-meta">
                  {t("landing.compare.usHeader")}
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
                    className={`w-[200px] border-b border-[color:var(--color-border-subtle)] px-5 py-5 align-top font-display-grotesk text-[18px] font-bold uppercase tracking-[-0.015em] ${
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
                    {t(r.themKey)}
                  </td>
                  <td className="border-b border-[color:var(--color-border-subtle)] px-5 py-5 align-top text-sm text-parchment">
                    {r.us(t)}
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
