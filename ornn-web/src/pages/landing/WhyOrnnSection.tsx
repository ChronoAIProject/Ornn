import { useTranslation } from "react-i18next";
import { BlueprintGrid, RegMark } from "./BlueprintGrid";
import { HighlighterMark } from "./HighlighterMark";

/**
 * "Why ornn" — three editorial pillars under the hero.
 */
export function WhyOrnnSection() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden">
      <BlueprintGrid />
      <div className="relative mx-auto max-w-[1280px] px-6 sm:px-8">
        <div className="pb-8 pt-8 sm:pb-10 sm:pt-12">
          <h2 className="max-w-[900px] font-display-grotesk text-[clamp(36px,4vw,56px)] font-bold uppercase leading-[0.98] tracking-[-0.025em] text-parchment">
            {t("landing.why.headlineLine1")}
            <br />
            {t("landing.why.headlineLine2Start")}{" "}
            <HighlighterMark>{t("landing.why.headlineLine2Highlight")}</HighlighterMark>{" "}
            {t("landing.why.headlineLine2End")}
          </h2>
        </div>

        <div className="grid grid-cols-1 border-y border-[color:var(--color-border-subtle)] md:grid-cols-3">
          <Pillar
            num="I"
            label={t("landing.why.pillarLabel")}
            title={
              <>
                {t("landing.why.pillar1Title")
                  .split(t("landing.why.pillar1TitleHighlight"))
                  .flatMap((piece, i, arr) =>
                    i < arr.length - 1
                      ? [piece, <HighlighterMark key={i}>{t("landing.why.pillar1TitleHighlight")}</HighlighterMark>]
                      : [piece],
                  )}
              </>
            }
            body={
              <>
                {t("landing.why.pillar1Body").split("{{cmd}}")[0]}
                <code className="rounded-[2px] bg-iron px-1.5 py-0.5 font-mono text-xs text-molten">
                  ornn-search-and-run
                </code>
                {t("landing.why.pillar1Body").split("{{cmd}}")[1]}
              </>
            }
            proof={t("landing.why.pillar1Proof")}
            border
          />
          <Pillar
            num="II"
            label={t("landing.why.pillarLabel")}
            title={
              <>
                {t("landing.why.pillar2Title")}
                <br />
                <HighlighterMark>
                  {t("landing.why.pillar2TitleHighlight")}
                </HighlighterMark>
                .
              </>
            }
            body={
              <>
                {t("landing.why.pillar2Body").split("{{cmd}}")[0]}
                <code className="rounded-[2px] bg-iron px-1.5 py-0.5 font-mono text-xs text-molten">
                  ornn-build
                </code>
                {t("landing.why.pillar2Body").split("{{cmd}}")[1]}
              </>
            }
            proof={t("landing.why.pillar2Proof")}
            border
          />
          <Pillar
            num="III"
            label={t("landing.why.pillarLabel")}
            title={
              <>
                {t("landing.why.pillar3Title")}{" "}
                <HighlighterMark>
                  {t("landing.why.pillar3TitleHighlight")}
                </HighlighterMark>
                .
              </>
            }
            body={t("landing.why.pillar3Body")}
            proof={t("landing.why.pillar3Proof")}
          />
        </div>
      </div>
    </section>
  );
}

function Pillar({
  num,
  label,
  title,
  body,
  proof,
  border = false,
}: {
  num: string;
  label: string;
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
          {label} · {num}
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
