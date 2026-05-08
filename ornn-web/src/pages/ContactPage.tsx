/**
 * Contact Page — Forge Workshop public surface.
 *
 * Two real channels: support email + GitHub issue tracker. The
 * placeholder Xiaohongshu card and the brand-decorative "WORKSHOP"
 * stamp were dropped in #320 — both offered no contact value, the
 * stamp wasn't even a link.
 *
 * Design language follows DESIGN.md "Whole-App Application Guidance →
 * App Shell": cool steel-paper page background (inherited from RootLayout),
 * letterpress-impression cards via `card-impression`, bracketed mono section
 * label, Space Grotesk display headline with `<HighlighterMark>` on the
 * emphasis noun, Inter body, JetBrains Mono operational labels.
 *
 * @module pages/ContactPage
 */

import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { HighlighterMark } from "@/pages/landing/HighlighterMark";

const SUPPORT_EMAIL = "support@chrono-ai.fun";
const GITHUB_REPO_URL = "https://github.com/ChronoAIProject/Ornn";

function MailIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.847-2.339 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

interface ChannelCardProps {
  label: string;
  icon: React.ReactNode;
  primary: React.ReactNode;
  helper: string;
  href?: string | null;
  external?: boolean;
  disabled?: boolean;
}

/**
 * One contact channel. Uses `card-impression` for the static letterpress
 * shadow and an inset 1px hairline. When `href` is provided the whole
 * card is a single anchor — the impression communicates "tappable",
 * mono uppercase label communicates "operational metadata".
 */
function ChannelCard({
  label,
  icon,
  primary,
  helper,
  href,
  external,
  disabled,
}: ChannelCardProps) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-meta">
          {label}
        </span>
        <span className="text-meta">{icon}</span>
      </div>
      <div className="mt-5 leading-tight text-strong">{primary}</div>
      <p className="mt-3 font-text text-[14px] leading-relaxed text-body">
        {helper}
      </p>
    </>
  );

  const baseClass =
    "card-impression flex h-full flex-col rounded-sm border border-subtle bg-card p-6 transition-colors duration-200";

  if (disabled || !href) {
    return (
      <div className={`${baseClass} cursor-default`} aria-disabled="true">
        {inner}
      </div>
    );
  }

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`${baseClass} no-underline hover:border-accent focus-visible:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
      >
        {inner}
      </a>
    );
  }

  return (
    <a
      href={href}
      className={`${baseClass} no-underline hover:border-accent focus-visible:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
    >
      {inner}
    </a>
  );
}

export function ContactPage() {
  const { t } = useTranslation();

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[960px] px-2 py-12 sm:py-16 lg:py-20">
          {/* Eyebrow + headline + subhead */}
          <header className="mb-10 sm:mb-14">
            <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-meta">
              {t("contact.eyebrow")}
            </p>
            <h1 className="font-display text-[40px] font-bold leading-[1.02] tracking-tight text-strong sm:text-[56px]">
              {t("contact.headlineStart")}{" "}
              <HighlighterMark className="highlighter-mark--loose">
                {t("contact.headlineHighlight")}
              </HighlighterMark>
              {t("contact.headlineEnd")}
            </h1>
            <p className="mt-6 max-w-[640px] font-text text-[16px] leading-relaxed text-body sm:text-[17px]">
              {t("contact.subhead")}
            </p>
          </header>

          {/* Channel grid — 1 col mobile, 2 col sm+. */}
          <section
            aria-label={t("contact.channelsLabel")}
            className="grid grid-cols-1 gap-5 sm:grid-cols-2"
          >
            <ChannelCard
              label={t("contact.cardEmailLabel")}
              icon={<MailIcon className="h-5 w-5" />}
              primary={
                <span className="block break-words font-mono text-[17px] font-medium tracking-tight">
                  {SUPPORT_EMAIL}
                </span>
              }
              helper={t("contact.cardEmailHint")}
              href={`mailto:${SUPPORT_EMAIL}`}
            />

            <ChannelCard
              label={t("contact.cardGithubLabel")}
              icon={<GitHubIcon className="h-5 w-5" />}
              primary={
                <span className="block break-words font-mono text-[17px] font-medium tracking-tight">
                  github.com/ChronoAIProject/Ornn
                </span>
              }
              helper={t("contact.cardGithubHint")}
              href={GITHUB_REPO_URL}
              external
            />
          </section>

          {/* Closing rule — small editorial signoff for credibility */}
          <footer className="mt-12 flex items-center gap-3 border-t border-subtle pt-6 sm:mt-16">
            <span className="h-1 w-14 bg-accent" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-meta">
              {t("contact.signoff")}
            </span>
          </footer>
        </div>
      </div>
    </PageTransition>
  );
}
