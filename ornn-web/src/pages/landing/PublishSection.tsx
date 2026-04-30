import { useTranslation } from "react-i18next";
import { EmberLink } from "./EmberButton";
import { HighlighterMark } from "./HighlighterMark";

export function PublishSection() {
  const { t } = useTranslation();
  return (
    <section
      id="build"
      className="relative scroll-mt-16 border-t border-[color:var(--color-border-subtle)] py-20 sm:py-32"
    >
      <div className="mx-auto max-w-[1280px] px-6 sm:px-8">
        <div className="grid grid-cols-1 items-center gap-14 border border-[color:var(--color-border-strong)] [background-image:var(--gradient-publish)] px-6 py-12 sm:px-12 sm:py-16 lg:[grid-template-columns:1.4fr_1fr]">
          <div>
            <h2 className="font-display-grotesk text-[clamp(36px,4vw,56px)] font-bold uppercase leading-[0.98] tracking-[-0.025em] text-parchment">
              {t("landing.publish.headlineLine1")}
              <br />
              <HighlighterMark variant="gold">
                {t("landing.publish.headlineLine2")}
              </HighlighterMark>
              .
            </h2>
            <p className="mt-5 max-w-[460px] text-sm leading-[1.6] text-bone">
              {t("landing.publish.body")}
            </p>
            <div className="mt-7 flex flex-wrap gap-3.5">
              <EmberLink to="/login">{t("landing.publish.startPublishing")}</EmberLink>
              <EmberLink to="/docs" variant="ghost">
                {t("landing.publish.readGuide")}
              </EmberLink>
            </div>
          </div>

          <ol className="m-0 list-none p-0 [counter-reset:step]">
            <Step
              title={t("landing.publish.step1Title")}
              body={
                <>
                  {t("landing.publish.step1Body")}{" "}
                  <code className="font-mono text-xs text-molten">
                    ornn-build &quot;summarize any GitHub PR into a changelog
                    entry.&quot;
                  </code>
                </>
              }
            />
            <Step
              title={t("landing.publish.step2Title")}
              body={
                <>
                  {t("landing.publish.step2BodyPrefix")}{" "}
                  <code className="font-mono text-xs text-molten">
                    chrono-sandbox
                  </code>{" "}
                  {t("landing.publish.step2BodySuffix")}
                </>
              }
            />
            <Step
              title={t("landing.publish.step3Title")}
              body={t("landing.publish.step3Body")}
              isLast
            />
          </ol>
        </div>
      </div>
    </section>
  );
}

function Step({
  title,
  body,
  isLast = false,
}: {
  title: string;
  body: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <li
      className={`grid grid-cols-[36px_1fr] items-baseline gap-4 py-4 [counter-increment:step] before:font-mono before:text-xs before:tracking-[0.06em] before:text-ember before:[content:counter(step,decimal-leading-zero)] ${
        isLast ? "" : "border-b border-dashed border-[color:var(--color-border-subtle)]"
      }`}
    >
      <div>
        <h4 className="font-display-grotesk text-[18px] font-bold uppercase tracking-[-0.02em] text-parchment">
          {title}
        </h4>
        <p className="mt-1 text-[13px] leading-[1.5] text-bone">{body}</p>
      </div>
    </li>
  );
}
