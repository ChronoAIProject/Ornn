import { EmberLink } from "./EmberButton";

export function PublishSection() {
  return (
    <section
      id="build"
      className="relative scroll-mt-16 border-t border-[color:var(--color-border-subtle)] py-20 sm:py-32"
    >
      <div className="mx-auto max-w-[1280px] px-6 sm:px-8">
        <div className="grid grid-cols-1 items-center gap-14 border border-[color:var(--color-border-strong)] [background-image:var(--gradient-publish)] px-6 py-12 sm:px-12 sm:py-16 lg:[grid-template-columns:1.4fr_1fr]">
          <div>
            <h2 className="font-display text-[clamp(38px,4vw,58px)] font-light leading-none tracking-[-0.03em] text-parchment">
              Publish a skill
              <br />
              <em className="italic font-normal text-ember">in 60 seconds</em>.
            </h2>
            <p className="mt-5 max-w-[460px] text-sm leading-[1.6] text-bone">
              You built something useful. Others need it too. Push to ORNN and
              it lives on the registry — versioned, audited, ready to pull into
              your agent.
            </p>
            <div className="mt-7 flex flex-wrap gap-3.5">
              <EmberLink to="/login">Start publishing →</EmberLink>
              <EmberLink to="/docs" variant="ghost">
                Read the guide
              </EmberLink>
            </div>
          </div>

          <ol className="m-0 list-none p-0 [counter-reset:step]">
            <Step
              title="Describe the skill."
              body={
                <>
                  Plain English.{" "}
                  <code className="font-mono text-xs text-molten">
                    ornn-build &quot;summarize any GitHub PR into a changelog
                    entry.&quot;
                  </code>
                </>
              }
            />
            <Step
              title="Test in the sandbox."
              body={
                <>
                  Run in{" "}
                  <code className="font-mono text-xs text-molten">
                    chrono-sandbox
                  </code>{" "}
                  (Node + Python). NyxID-gated for anything that needs auth.
                </>
              }
            />
            <Step
              title="Audit & ship."
              body="One command. Versioned, audited, live on the registry."
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
        <h4 className="font-display text-[20px] font-normal tracking-[-0.015em] text-parchment">
          {title}
        </h4>
        <p className="mt-1 text-[13px] leading-[1.5] text-bone">{body}</p>
      </div>
    </li>
  );
}
