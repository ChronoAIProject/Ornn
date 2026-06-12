/**
 * Documentation Page — tech-docs style with collapsible left sidebar + content + sticky TOC minimap.
 * Renders markdown files with mermaid diagram support.
 * Publicly accessible, no auth required.
 * @module pages/DocsPage
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { PageTransition } from "@/components/layout/PageTransition";
import { useTranslation } from "react-i18next";
import { markdownComponents } from "@/components/docs/DocsMarkdownComponents.map";
import { slugify } from "@/components/docs/DocsMarkdownComponents.helpers";
import {
  ReleaseAccordion,
  VersionBadge,
} from "@/components/docs/DocsReleaseAccordion";
import { DocsSidebar } from "@/components/docs/DocsSidebar";
import { DocsTableOfContents } from "@/components/docs/DocsTableOfContents";
import { getDocsTree, getDocContent } from "@/lib/docsContent";

/* ──────────────── Types ──────────────── */

type Lang = "en" | "zh";

interface TocItem {
  id: string;
  text: string;
  level: number;
}


/* ──────────────── Extract TOC from markdown ──────────────── */

function extractToc(md: string): TocItem[] {
  const items: TocItem[] = [];
  const lines = md.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = /^(#{1,4})\s+(.+)$/.exec(line);
    if (match) {
      // Both capture groups are always present on match. `!` is safe
      // under noUncheckedIndexedAccess (#450).
      const level = match[1]!.length;
      const text = match[2]!.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
      items.push({ id: slugify(text), text, level });
    }
  }
  return items;
}



/* ──────────────── Page component ──────────────── */

export function DocsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const lang = (i18n.language === "zh" ? "zh" : "en") as Lang;

  const [activeHeadingId, setActiveHeadingId] = useState("");
  const [docCopied, setDocCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const menu = useMemo(() => getDocsTree(lang), [lang]);
  const defaultDocId = menu?.defaultDoc ?? "what-is-ornn";
  const activeId = searchParams.get("section") ?? defaultDocId;

  const markdown = useMemo(() => {
    const content = getDocContent(lang, activeId);
    return content ?? `# ${t("docs.notFound")}\n\nCould not load \`${activeId}\`.`;
  }, [lang, activeId, t]);

  // Parse a single leading YAML frontmatter block (`---\n...\n---`).
  // - `displayMarkdown` strips the block so it doesn't render as bold prose.
  // - `frontmatter` is the parsed key/value object — used to render a
  //   small version badge (and `lastUpdated`) at the top of the article.
  // - The raw `markdown` (with frontmatter intact) is what the Copy-as-
  //   markdown button copies, so the doc stays paste-installable elsewhere.
  const { displayMarkdown, frontmatter } = useMemo(() => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/m.exec(markdown);
    if (!m || m.index !== 0) {
      return { displayMarkdown: markdown, frontmatter: {} as Record<string, string> };
    }
    const fm: Record<string, string> = {};
    // Capture group 1 is always present on match. `!` is safe under
    // noUncheckedIndexedAccess (#450).
    for (const raw of m[1]!.split(/\r?\n/)) {
      const kv = /^\s*([A-Za-z][\w-]*)\s*:\s*(.+?)\s*$/.exec(raw);
      if (kv) fm[kv[1]!] = kv[2]!.replace(/^['"]|['"]$/g, "");
    }
    return { displayMarkdown: markdown.slice(m[0]!.length), frontmatter: fm };
  }, [markdown]);

  // Every doc is copyable; nothing on the docs site today is paste-
  // installable as a skill (the agent manual was retired and now lives
  // as the `ornn-agent-manual` Ornn system skill, fetched via API).
  const handleCopyDoc = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setDocCopied(true);
      setTimeout(() => setDocCopied(false), 1800);
    } catch {
      /* ignore clipboard errors — older browsers, sandboxed iframes, etc. */
    }
  }, [markdown]);

  const toc = useMemo(() => extractToc(displayMarkdown), [displayMarkdown]);

  // Scroll-spy: track which heading is currently in view
  useEffect(() => {
    const container = contentRef.current;
    if (!container || toc.length === 0) return;

    const handleScroll = () => {
      const headings = container.querySelectorAll("h1[id], h2[id], h3[id], h4[id]");
      let current = "";
      for (const heading of headings) {
        const rect = heading.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (rect.top - containerRect.top <= 80) {
          current = heading.id;
        }
      }
      setActiveHeadingId(current);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    // Initial check
    handleScroll();
    return () => container.removeEventListener("scroll", handleScroll);
  }, [toc]);

  // Resolve doc label from menu structure
  const resolveLabel = useCallback((docId: string): string | undefined => {
    if (!menu) return undefined;
    for (const section of menu.sections) {
      const child = section.children.find((c) => c.id === docId);
      if (child) return child.label;
    }
    return undefined;
  }, [menu]);

  // Set title param for breadcrumb when menu loads or activeId changes
  useEffect(() => {
    if (!menu) return;
    const currentTitle = searchParams.get("title");
    const label = resolveLabel(activeId);
    if (label && label !== currentTitle) {
      setSearchParams({ section: activeId, title: label }, { replace: true });
    }
  }, [menu, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (id: string, label: string) => {
    setSearchParams({ section: id, title: label });
  };

  const handleTocClick = (headingId: string) => {
    const container = contentRef.current;
    if (!container) return;
    const el = container.querySelector(`#${CSS.escape(headingId)}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <PageTransition>
      <div className="flex h-full min-h-0 gap-0">
        {/* Left sidebar — collapsible doc browser */}
        <DocsSidebar sections={menu?.sections ?? []} activeId={activeId} onSelect={handleSelect} />

        {/* Right — doc content area with TOC minimap */}
        <div className="flex-1 min-w-0 flex min-h-0">
          {/* Main content — scrollable */}
          <div ref={contentRef} className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-6">
            {displayMarkdown.includes("<!-- RELEASES -->") ? (
              /* Release-history pages: split at placeholder and inject accordion */
              <article className="markdown-body max-w-4xl mx-auto">
                {(() => {
                  const [before, after] = displayMarkdown.split("<!-- RELEASES -->");
                  return (
                    <>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={markdownComponents as never}
                      >
                        {before}
                      </ReactMarkdown>
                      <ReleaseAccordion lang={lang} />
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={markdownComponents as never}
                      >
                        {after}
                      </ReactMarkdown>
                    </>
                  );
                })()}
              </article>
            ) : displayMarkdown.includes("<!-- VERSION_BADGE -->") ? (
              /* What is Ornn: inject dynamic version badge linking to GitHub Releases */
              <article className="markdown-body max-w-4xl mx-auto">
                {(() => {
                  const [before, after] = displayMarkdown.split("<!-- VERSION_BADGE -->");
                  return (
                    <>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={markdownComponents as never}
                      >
                        {before}
                      </ReactMarkdown>
                      <VersionBadge />
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={markdownComponents as never}
                      >
                        {after}
                      </ReactMarkdown>
                    </>
                  );
                })()}
              </article>
            ) : (
              <article className="markdown-body max-w-4xl mx-auto">
                <div className="not-prose mb-6 flex flex-wrap items-center justify-between gap-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-meta">
                    {frontmatter.version && <span>v{frontmatter.version}</span>}
                    {frontmatter.version && frontmatter.lastUpdated && (
                      <span className="opacity-50"> · </span>
                    )}
                    {frontmatter.lastUpdated && <span>updated {frontmatter.lastUpdated}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyDoc}
                    className={`inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-150 cursor-pointer ${
                      docCopied
                        ? "border-success/60 bg-success-soft text-success"
                        : "border-strong-edge text-meta hover:border-strong hover:text-strong"
                    }`}
                    aria-label={t("docs.copyMarkdown", "Copy as markdown")}
                    title={t("docs.copyMarkdownHint", "Copy this whole document as markdown — paste into your AI agent to install it as a skill") as string}
                  >
                    {docCopied ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        {t("docs.copied", "Copied")}
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <rect x="9" y="9" width="13" height="13" rx="1" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        {t("docs.copyMarkdown", "Copy as markdown")}
                      </>
                    )}
                  </button>
                </div>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={markdownComponents as never}
                >
                  {displayMarkdown}
                </ReactMarkdown>
              </article>
            )}
          </div>

          {/* TOC minimap — sticky right side */}
          {toc.length > 0 && (
            <DocsTableOfContents
              items={toc}
              activeHeadingId={activeHeadingId}
              onSelect={handleTocClick}
            />
          )}
        </div>
      </div>
    </PageTransition>
  );
}
