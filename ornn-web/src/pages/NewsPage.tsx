/**
 * News Page — Forge Workshop public archive of every released
 * announcement (#357).
 *
 * Counterpart to the landing-page popup: the popup surfaces only the
 * single most recent in-window announcement and disappears on dismiss;
 * this page is the persistent archive any visitor (anonymous, signed-in,
 * or admin) can walk through. Past/expired records remain visible —
 * News is by design historical.
 *
 * Design language mirrors `ContactPage` per DESIGN.md "Whole-App
 * Application Guidance → App Shell": cool steel-paper page background
 * (inherited from RootLayout), letterpress-impression cards via
 * `card-impression`, bracketed mono section label, Space Grotesk display
 * headline with `<HighlighterMark>` on the emphasis noun. Markdown body
 * uses the same `react-markdown` + `remark-gfm` + `rehype-sanitize`
 * pipeline used by AnnouncementPopup, against the regular card surface
 * so the default `.markdown-body` tokens read cleanly without ink
 * overrides.
 *
 * @module pages/NewsPage
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { PageTransition } from "@/components/layout/PageTransition";
import { HighlighterMark } from "@/pages/landing/HighlighterMark";
import { usePublicAnnouncements } from "@/hooks/useAnnouncements";
import type { PublicAnnouncementListItem } from "@/services/announcementsApi";

function formatPublishedAt(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const bcp47 = locale === "zh" ? "zh-CN" : "en-US";
  try {
    return new Intl.DateTimeFormat(bcp47, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

interface NewsEntryProps {
  item: PublicAnnouncementListItem;
  locale: string;
}

/**
 * One archive entry. Same letterpress vocabulary as the Contact channel
 * card: hairline border, `card-impression` static shadow, mono uppercase
 * eyebrow for operational metadata (the publish date). The body is
 * sanitized markdown on the regular card surface, so the default
 * `.markdown-body` token bindings are exactly what we want — no ink
 * overrides needed.
 */
function NewsEntry({ item, locale }: NewsEntryProps) {
  const isExternalCta = item.ctaUrl
    ? /^https?:\/\//i.test(item.ctaUrl)
    : false;
  const headingId = `news-entry-${item.id}-title`;

  return (
    <article
      id={`announcement-${item.id}`}
      aria-labelledby={headingId}
      className="card-impression flex flex-col gap-4 rounded-sm border border-subtle bg-card p-6 sm:p-8"
    >
      <header className="flex flex-col gap-3">
        <time
          dateTime={item.publishedAt}
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-meta"
        >
          {formatPublishedAt(item.publishedAt, locale)}
        </time>
        <h2
          id={headingId}
          className="font-display text-[24px] font-bold leading-[1.08] tracking-tight text-strong sm:text-[28px]"
        >
          {item.title}
        </h2>
      </header>

      <div className="markdown-body text-[15px] leading-[1.65] text-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {item.bodyMarkdown}
        </ReactMarkdown>
      </div>

      {item.ctaUrl && item.ctaLabel && (
        <div>
          <a
            href={item.ctaUrl}
            target={isExternalCta ? "_blank" : undefined}
            rel={isExternalCta ? "noopener noreferrer" : undefined}
            className="cta-letterpress cta-letterpress--ghost inline-flex items-center gap-2 rounded-sm border border-strong-edge bg-card px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-strong no-underline hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {item.ctaLabel}
            {isExternalCta && (
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-3.5 w-3.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14 5h5v5M19 5L9 15M5 11v8h8"
                />
              </svg>
            )}
          </a>
        </div>
      )}
    </article>
  );
}

export function NewsPage() {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = usePublicAnnouncements();

  // Stable locale snapshot — avoids a render-loop should i18n.language
  // be a getter that re-allocates.
  const locale = useMemo(() => i18n.language ?? "en", [i18n.language]);

  return (
    <PageTransition>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[960px] px-2 py-12 sm:py-16 lg:py-20">
          {/* Eyebrow + headline + subhead — same editorial vocabulary as
              Contact / Docs landing surfaces. */}
          <header className="mb-10 sm:mb-14">
            <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.22em] text-meta">
              {t("news.eyebrow")}
            </p>
            <h1 className="font-display text-[40px] font-bold leading-[1.02] tracking-tight text-strong sm:text-[56px]">
              {t("news.headlineStart")}{" "}
              <HighlighterMark className="highlighter-mark--loose">
                {t("news.headlineHighlight")}
              </HighlighterMark>
              {t("news.headlineEnd")}
            </h1>
            <p className="mt-6 max-w-[640px] font-text text-[16px] leading-relaxed text-body sm:text-[17px]">
              {t("news.subhead")}
            </p>
          </header>

          <section aria-label={t("news.archiveLabel")} className="flex flex-col gap-6">
            {isLoading && (
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-meta">
                {t("news.loading")}
              </p>
            )}

            {isError && (
              <div className="card-impression rounded-sm border border-subtle bg-card p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-meta">
                  {t("news.errorLabel")}
                </p>
                <p className="mt-3 font-text text-[15px] leading-relaxed text-body">
                  {t("news.errorBody")}
                </p>
              </div>
            )}

            {data && data.length === 0 && (
              <div className="card-impression rounded-sm border border-subtle bg-card p-6 sm:p-8">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-meta">
                  {t("news.emptyLabel")}
                </p>
                <p className="mt-3 font-text text-[15px] leading-relaxed text-body">
                  {t("news.emptyBody")}
                </p>
              </div>
            )}

            {data?.map((item) => (
              <NewsEntry key={item.id} item={item} locale={locale} />
            ))}
          </section>

          <footer className="mt-12 flex items-center gap-3 border-t border-subtle pt-6 sm:mt-16">
            <span className="h-1 w-14 bg-accent" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-meta">
              {t("news.signoff")}
            </span>
          </footer>
        </div>
      </div>
    </PageTransition>
  );
}
