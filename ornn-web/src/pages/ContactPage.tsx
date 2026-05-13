/**
 * Contact Page — public channel-routing surface.
 *
 * Three real channels with distinct purposes:
 *   1. `support@chrono-ai.fun` — sensitive / private (security, account,
 *      GDPR). Anything you don't want public.
 *   2. GitHub Discussions — async public community. Q&A, ideas,
 *      show-and-tell. Default entry point when in doubt.
 *   3. GitHub Issues / PRs — actionable maintainer work (confirmed bugs
 *      with repro, accepted feature scope, code contributions).
 *
 * Below the three channel cards, a "Discussion categories" section
 * enumerates every category on the repo with its one-line purpose, so
 * users land in the right place without trial-and-error.
 *
 * Design language follows DESIGN.md "Whole-App Application Guidance →
 * App Shell": letterpress-impression cards via `card-impression`,
 * bracketed mono section labels, Space Grotesk display headline with
 * `<HighlighterMark>` on the emphasis noun, Inter body, JetBrains Mono
 * operational labels.
 *
 * @module pages/ContactPage
 */

import { useTranslation } from "react-i18next";
import { PageTransition } from "@/components/layout/PageTransition";
import { HighlighterMark } from "@/pages/landing/HighlighterMark";

const SUPPORT_EMAIL = "support@chrono-ai.fun";
const GITHUB_REPO_URL = "https://github.com/ChronoAIProject/Ornn";
const GITHUB_DISCUSSIONS_URL = `${GITHUB_REPO_URL}/discussions`;
const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;

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

/**
 * Speech-bubble icon for the Discussions card — distinguishes it from
 * the Issues card at a glance even though both link to GitHub.
 */
function ChatIcon({ className }: { className?: string }) {
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
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

interface ChannelCardProps {
  label: string;
  icon: React.ReactNode;
  primary: React.ReactNode;
  helper: string;
  href: string;
  external?: boolean;
}

/**
 * One contact channel. The whole card is a single anchor — the
 * letterpress impression communicates "tappable", mono uppercase label
 * communicates "operational metadata". Border lights up on hover/focus.
 */
function ChannelCard({ label, icon, primary, helper, href, external }: ChannelCardProps) {
  const baseClass =
    "card-impression flex h-full flex-col rounded-sm border border-subtle bg-card p-6 no-underline transition-colors duration-200 hover:border-accent focus-visible:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
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
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={baseClass}>
        {inner}
      </a>
    );
  }
  return (
    <a href={href} className={baseClass}>
      {inner}
    </a>
  );
}

/**
 * One row in the Discussion-categories list. Whole row is a link to
 * the GitHub Discussions category page, so the user lands one click
 * away from posting. Visual treatment is intentionally lighter than
 * the channel cards above — secondary content, not the primary CTA.
 */
function CategoryRow({
  emoji,
  name,
  purpose,
  href,
}: {
  emoji: string;
  name: string;
  purpose: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex h-full items-start gap-3 rounded-sm border border-subtle bg-card px-4 py-3 no-underline transition-colors duration-200 hover:border-accent focus-visible:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="mt-0.5 text-base leading-none" aria-hidden="true">
        {emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[12px] font-medium tracking-tight text-strong">
          {name}
        </div>
        <p className="mt-1 font-text text-[13px] leading-relaxed text-body">
          {purpose}
        </p>
      </div>
    </a>
  );
}

const DISCUSSION_CATEGORIES = [
  {
    slug: "announcements",
    emoji: "📣",
    nameKey: "contact.categoryAnnouncementsName",
    purposeKey: "contact.categoryAnnouncementsPurpose",
  },
  {
    slug: "q-a",
    emoji: "🙏",
    nameKey: "contact.categoryQaName",
    purposeKey: "contact.categoryQaPurpose",
  },
  {
    slug: "ideas",
    emoji: "💡",
    nameKey: "contact.categoryIdeasName",
    purposeKey: "contact.categoryIdeasPurpose",
  },
  {
    slug: "show-and-tell",
    emoji: "🙌",
    nameKey: "contact.categoryShowAndTellName",
    purposeKey: "contact.categoryShowAndTellPurpose",
  },
  {
    slug: "general",
    emoji: "💬",
    nameKey: "contact.categoryGeneralName",
    purposeKey: "contact.categoryGeneralPurpose",
  },
  {
    slug: "polls",
    emoji: "🗳",
    nameKey: "contact.categoryPollsName",
    purposeKey: "contact.categoryPollsPurpose",
  },
] as const;

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

          {/* Channel grid — 1 col mobile, 3 col on lg+. */}
          <section
            aria-label={t("contact.channelsLabel")}
            className="grid grid-cols-1 gap-5 lg:grid-cols-3"
          >
            <ChannelCard
              label={t("contact.cardEmailLabel")}
              icon={<MailIcon className="h-5 w-5" />}
              primary={
                <span className="block break-words font-mono text-[15px] font-medium tracking-tight">
                  {SUPPORT_EMAIL}
                </span>
              }
              helper={t("contact.cardEmailHint")}
              href={`mailto:${SUPPORT_EMAIL}`}
            />

            <ChannelCard
              label={t("contact.cardDiscussionsLabel")}
              icon={<ChatIcon className="h-5 w-5" />}
              primary={
                <span className="block break-words font-mono text-[15px] font-medium tracking-tight">
                  github.com/.../discussions
                </span>
              }
              helper={t("contact.cardDiscussionsHint")}
              href={GITHUB_DISCUSSIONS_URL}
              external
            />

            <ChannelCard
              label={t("contact.cardIssuesLabel")}
              icon={<GitHubIcon className="h-5 w-5" />}
              primary={
                <span className="block break-words font-mono text-[15px] font-medium tracking-tight">
                  github.com/.../issues
                </span>
              }
              helper={t("contact.cardIssuesHint")}
              href={GITHUB_ISSUES_URL}
              external
            />
          </section>

          {/* Discussion categories — secondary, routing-table style. */}
          <section
            aria-label={t("contact.categoriesHeadline")}
            className="mt-16"
          >
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-meta">
              {t("contact.categoriesEyebrow")}
            </p>
            <h2 className="font-display text-[24px] font-semibold leading-tight tracking-tight text-strong sm:text-[28px]">
              {t("contact.categoriesHeadline")}
            </h2>
            <p className="mt-3 max-w-[640px] font-text text-[14px] leading-relaxed text-body">
              {t("contact.categoriesSubhead")}
            </p>
            <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DISCUSSION_CATEGORIES.map((c) => (
                <li key={c.slug}>
                  <CategoryRow
                    emoji={c.emoji}
                    name={t(c.nameKey)}
                    purpose={t(c.purposeKey)}
                    href={`${GITHUB_DISCUSSIONS_URL}/categories/${c.slug}`}
                  />
                </li>
              ))}
            </ul>
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
