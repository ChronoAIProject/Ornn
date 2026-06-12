/**
 * Release notes accordion + current-version badge, extracted from
 * DocsPage (#453).
 *
 * ReleaseAccordion: collapsible list of every release, newest first.
 * The newest one is auto-expanded on first render and tagged with a
 * "Current"/"当前版本" eyebrow.
 *
 * VersionBadge: small inline badge surfaced at the top of the release
 * notes doc — shows __APP_VERSION__ + a link to GitHub Releases.
 *
 * @module components/docs/DocsReleaseAccordion
 */

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useTranslation } from "react-i18next";
import { getReleases, getRelease } from "@/lib/docsContent";

type Lang = "en" | "zh";

function ChevronIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`${className ?? "h-4 w-4"} transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function ReleaseAccordion({ lang }: { lang: Lang }) {
  const releases = useMemo(() => getReleases(lang), [lang]);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(
    () => releases[0]?.version ?? null,
  );
  const { t } = useTranslation();

  const expandedContent = useMemo(
    () => (expandedVersion ? getRelease(expandedVersion, lang)?.content ?? null : null),
    [expandedVersion, lang],
  );

  const handleToggle = (version: string) => {
    setExpandedVersion((prev) => (prev === version ? null : version));
  };

  if (releases.length === 0) return null;

  return (
    <div className="my-8">
      <h2 id={slugify(lang === "zh" ? "已发布版本" : "released-versions")} className="font-display text-2xl font-bold text-accent mb-4">
        {lang === "zh" ? "已发布版本" : "Released Versions"}
      </h2>
      <div className="space-y-2">
        {releases.map((release, idx) => {
          const isOpen = expandedVersion === release.version;
          const isLatest = idx === 0;
          return (
            <div
              key={release.version}
              className="rounded border border-accent/20 overflow-hidden transition-colors hover:border-accent/40"
            >
              <button
                type="button"
                onClick={() => handleToggle(release.version)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left cursor-pointer transition-colors hover:bg-accent/5"
              >
                <ChevronIcon open={isOpen} className="h-4 w-4 text-meta shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-display text-base font-semibold text-strong">
                    v{release.version}
                  </span>
                  <span className="font-text text-sm text-meta ml-2">
                    — {release.title}
                  </span>
                  {isLatest && (
                    <span className="ml-2 inline-block px-2 py-0.5 rounded-sm text-[10px] font-mono uppercase tracking-[0.12em] bg-accent/10 text-accent border border-accent/40">
                      {lang === "zh" ? "当前版本" : "Current"}
                    </span>
                  )}
                </div>
                <span className="font-mono text-xs text-meta shrink-0">{release.date}</span>
              </button>
              {isOpen && (
                <div className="px-5 pb-4 border-t border-accent/10">
                  {expandedContent ? (
                    <div className="markdown-body pt-3">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                        {expandedContent}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="py-4 text-meta text-sm">{t("docs.loadFailed")}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VersionBadge() {
  const releasesUrl = "https://github.com/ChronoAIProject/Ornn/releases";
  return (
    <div className="my-6 inline-flex flex-wrap items-center gap-3 rounded border border-accent/20 bg-elevated px-4 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
        Current version
      </span>
      <span className="font-mono text-base text-accent">v{__APP_VERSION__}</span>
      <span className="text-meta">·</span>
      <a
        href={releasesUrl}
        target="_blank"
        rel="noreferrer"
        className="font-text text-sm text-meta transition-colors hover:text-strong"
      >
        Release history on GitHub →
      </a>
    </div>
  );
}
