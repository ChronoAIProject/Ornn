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
import mermaid from "mermaid";
import { PageTransition } from "@/components/layout/PageTransition";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/stores/themeStore";
import {
  getDocsTree,
  getDocContent,
  getReleases,
  getRelease,
  type DocSection,
} from "@/lib/docsContent";

/* ──────────────── Types ──────────────── */

type Lang = "en" | "zh";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

/* ──────────────── Chevron icon ──────────────── */

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

/* ──────────────── Heading slug helper ──────────────── */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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
      const level = match[1].length;
      const text = match[2].replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
      items.push({ id: slugify(text), text, level });
    }
  }
  return items;
}

/* ──────────────── Release Accordion ──────────────── */

function ReleaseAccordion({ lang }: { lang: Lang }) {
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
      <h2 id={slugify(lang === "zh" ? "已发布版本" : "released-versions")} className="font-heading text-2xl font-bold text-neon-cyan mb-4">
        {lang === "zh" ? "已发布版本" : "Released Versions"}
      </h2>
      <div className="space-y-2">
        {releases.map((release, idx) => {
          const isOpen = expandedVersion === release.version;
          const isLatest = idx === 0;
          return (
            <div
              key={release.version}
              className="rounded-lg border border-neon-cyan/20 overflow-hidden transition-colors hover:border-neon-cyan/40"
            >
              <button
                type="button"
                onClick={() => handleToggle(release.version)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left cursor-pointer transition-colors hover:bg-neon-cyan/5"
              >
                <ChevronIcon open={isOpen} className="h-4 w-4 text-text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-heading text-base font-semibold text-text-primary">
                    v{release.version}
                  </span>
                  <span className="font-body text-sm text-text-muted ml-2">
                    — {release.title}
                  </span>
                  {isLatest && (
                    <span className="ml-2 inline-block px-2 py-0.5 rounded text-xs font-heading bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30">
                      {lang === "zh" ? "当前版本" : "Current"}
                    </span>
                  )}
                </div>
                <span className="font-mono text-xs text-text-muted shrink-0">{release.date}</span>
              </button>
              {isOpen && (
                <div className="px-5 pb-4 border-t border-neon-cyan/10">
                  {expandedContent ? (
                    <div className="markdown-body pt-3">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                        {expandedContent}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="py-4 text-text-muted text-sm">{t("docs.loadFailed")}</p>
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

/* ──────────────── Mermaid theme configs ──────────────── */

const MERMAID_DARK = {
  startOnLoad: false,
  theme: "dark" as const,
  themeVariables: {
    darkMode: true,
    primaryColor: "#FF6B00",
    primaryTextColor: "#e8e8e8",
    primaryBorderColor: "#FF6B00",
    lineColor: "#FF8C38",
    secondaryColor: "#1e1e1e",
    tertiaryColor: "#131313",
    background: "#0a0a0f",
    mainBkg: "#1e1e1e",
    nodeBorder: "#FF6B00",
    clusterBkg: "#131313",
    clusterBorder: "#FF6B0044",
    titleColor: "#FF6B00",
    edgeLabelBackground: "#0a0a0f",
    noteTextColor: "#e8e8e8",
    noteBkgColor: "#1e1e1e",
    noteBorderColor: "#FF6B0044",
    actorTextColor: "#e8e8e8",
    actorBkg: "#1e1e1e",
    actorBorder: "#FF6B00",
    signalColor: "#FF8C38",
    signalTextColor: "#e8e8e8",
    labelTextColor: "#e8e8e8",
    loopTextColor: "#e8e8e8",
  },
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 13,
};

const MERMAID_LIGHT = {
  startOnLoad: false,
  theme: "base" as const,
  themeVariables: {
    darkMode: false,
    primaryColor: "#d45a00",
    primaryTextColor: "#2d2d2d",
    primaryBorderColor: "#d45a00",
    lineColor: "#c06000",
    secondaryColor: "#f3f3f5",
    tertiaryColor: "#ffffff",
    background: "#fafafa",
    mainBkg: "#fff5ee",
    nodeBorder: "#d45a00",
    clusterBkg: "#fdf6f0",
    clusterBorder: "#d45a0044",
    titleColor: "#b34a00",
    edgeLabelBackground: "#fafafa",
    noteTextColor: "#2d2d2d",
    noteBkgColor: "#fff5ee",
    noteBorderColor: "#d45a0044",
    actorTextColor: "#2d2d2d",
    actorBkg: "#fff5ee",
    actorBorder: "#d45a00",
    signalColor: "#c06000",
    signalTextColor: "#2d2d2d",
    labelTextColor: "#2d2d2d",
    loopTextColor: "#2d2d2d",
  },
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 13,
};

function getMermaidConfig(theme: "dark" | "light") {
  return theme === "dark" ? MERMAID_DARK : MERMAID_LIGHT;
}

// Initial init with current theme
mermaid.initialize(getMermaidConfig(useThemeStore.getState().theme));

/* ──────────────── Mermaid lightbox (zoom + pan) ──────────────── */

function MermaidLightbox({ svg, onClose }: { svg: string; onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 });

  // Zoom with scroll wheel
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale((s) => Math.min(Math.max(0.2, s + delta), 5));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.target === viewportRef.current) { onClose(); return; }
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, originX: translate.x, originY: translate.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setTranslate({ x: dragRef.current.originX + dx, y: dragRef.current.originY + dy });
  };

  const handlePointerUp = () => { dragRef.current.dragging = false; };

  const handleReset = () => { setScale(1); setTranslate({ x: 0, y: 0 }); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <button type="button" onClick={() => setScale((s) => Math.min(s + 0.25, 5))} className="rounded-lg bg-bg-elevated px-3 py-1.5 font-mono text-sm text-text-primary hover:bg-neon-cyan/20 transition-colors cursor-pointer">+</button>
        <span className="rounded-lg bg-bg-elevated px-3 py-1.5 font-mono text-sm text-text-muted min-w-[4rem] text-center">{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => setScale((s) => Math.max(s - 0.25, 0.2))} className="rounded-lg bg-bg-elevated px-3 py-1.5 font-mono text-sm text-text-primary hover:bg-neon-cyan/20 transition-colors cursor-pointer">−</button>
        <button type="button" onClick={handleReset} className="rounded-lg bg-bg-elevated px-3 py-1.5 font-mono text-sm text-text-primary hover:bg-neon-cyan/20 transition-colors cursor-pointer">Reset</button>
        <button type="button" onClick={onClose} className="rounded-lg bg-bg-elevated px-3 py-1.5 font-mono text-sm text-text-primary hover:bg-neon-cyan/20 transition-colors cursor-pointer">✕</button>
      </div>
      {/* Viewport */}
      <div
        ref={viewportRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          ref={contentRef}
          className="absolute left-1/2 top-1/2 mermaid-container [&_svg]:max-w-none"
          style={{ transform: `translate(-50%, -50%) translate(${translate.x}px, ${translate.y}px) scale(${scale})`, transformOrigin: "center center" }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}

/* ──────────────── Mermaid block component ──────────────── */

let mermaidCounter = 0;

function MermaidBlock({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++mermaidCounter}`;

    // Re-initialize mermaid with current theme before rendering
    mermaid.initialize(getMermaidConfig(theme));

    mermaid.render(id, chart).then(({ svg: rendered }) => {
      if (!cancelled) setSvg(rendered);
    }).catch((err) => {
      if (!cancelled) setSvg(`<pre style="color:#ff003c">Mermaid error: ${err.message}</pre>`);
    });

    return () => { cancelled = true; };
  }, [chart, theme]);

  return (
    <>
      <div
        ref={containerRef}
        className="mermaid-container group relative my-4 overflow-x-auto rounded-lg border border-neon-cyan/10 bg-bg-deep p-4 cursor-pointer [&_svg]:mx-auto [&_svg]:max-w-full"
        onClick={() => setLightboxOpen(true)}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {lightboxOpen && <MermaidLightbox svg={svg} onClose={() => setLightboxOpen(false)} />}
    </>
  );
}

/* ──────────────── Custom code component for react-markdown ──────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may not be available */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 z-10 px-2 py-1 rounded text-xs font-mono transition-all cursor-pointer border border-neon-cyan/30 bg-bg-deep/80 text-text-muted hover:text-neon-cyan hover:border-neon-cyan/60"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/** Wraps <pre> blocks with a relative container and copy button outside the scrollable area */
function PreBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const codeText = useRef("");

  // Extract text content from children (the <code> element inside <pre>)
  const extractText = (node: React.ReactNode): string => {
    if (typeof node === "string") return node;
    if (typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(extractText).join("");
    if (node && typeof node === "object" && "props" in node) {
      const el = node as { props?: { children?: React.ReactNode } };
      return extractText(el.props?.children);
    }
    return "";
  };

  codeText.current = extractText(children).replace(/\n$/, "");

  return (
    <div className="relative">
      <CopyButton text={codeText.current} />
      <pre {...props}>{children}</pre>
    </div>
  );
}

function CodeBlock({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const match = /language-(\w+)/.exec(className ?? "");
  const lang = match?.[1];
  const code = String(children).replace(/\n$/, "");

  if (lang === "mermaid") {
    return <MermaidBlock chart={code} />;
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

/* ──────────────── Heading components that inject IDs ──────────────── */

function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("");
  if (children && typeof children === "object" && "props" in children) {
    const el = children as { props?: { children?: React.ReactNode } };
    return extractTextFromChildren(el.props?.children);
  }
  return "";
}

function H1({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const id = slugify(extractTextFromChildren(children));
  return <h1 id={id} {...props}>{children}</h1>;
}
function H2({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const id = slugify(extractTextFromChildren(children));
  return <h2 id={id} {...props}>{children}</h2>;
}
function H3({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const id = slugify(extractTextFromChildren(children));
  return <h3 id={id} {...props}>{children}</h3>;
}
function H4({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const id = slugify(extractTextFromChildren(children));
  return <h4 id={id} {...props}>{children}</h4>;
}

const headingComponents = { h1: H1, h2: H2, h3: H3, h4: H4 };

/* ──────────────── Sidebar with collapsible sections ──────────────── */

function Sidebar({
  sections,
  activeId,
  onSelect,
}: {
  sections: DocSection[];
  activeId: string;
  onSelect: (id: string, label: string) => void;
}) {
  // Initialize: expand the section that contains the active doc
  const activeSectionId = sections.find((s) =>
    s.children.some((c) => c.id === activeId)
  )?.id;

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (activeSectionId) initial.add(activeSectionId);
    return initial;
  });

  // When active doc changes, ensure its section is expanded
  useEffect(() => {
    if (activeSectionId && !expanded.has(activeSectionId)) {
      setExpanded((prev) => new Set(prev).add(activeSectionId));
    }
  }, [activeSectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSection = (sectionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  return (
    <nav className="w-64 shrink-0 border-r border-neon-cyan/10 overflow-y-auto py-4 pr-2">
      {sections.map((section) => {
        const isExpanded = expanded.has(section.id);
        return (
          <div key={section.id} className="mb-2">
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center gap-2 px-3 py-2 cursor-pointer group text-left"
            >
              <ChevronIcon
                open={isExpanded}
                className="h-4 w-4 shrink-0 text-text-muted group-hover:text-text-primary transition-colors"
              />
              <span className="font-heading text-sm uppercase tracking-wider text-text-muted group-hover:text-text-primary transition-colors">
                {section.label}
              </span>
            </button>
            {isExpanded && (
              <div className="ml-2">
                {section.children.map((child) => {
                  const isActive = child.id === activeId;
                  return (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => onSelect(child.id, child.label)}
                      className={`
                        w-full text-left px-3 py-2 rounded-md font-body text-base transition-all duration-150 cursor-pointer
                        ${isActive
                          ? "text-neon-cyan bg-neon-cyan/10 border-l-2 border-neon-cyan"
                          : "text-text-muted hover:text-text-primary hover:bg-bg-elevated border-l-2 border-transparent"
                        }
                      `}
                    >
                      {child.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* ──────────────── Table of Contents (sticky right minimap) ──────────────── */

function TableOfContents({
  items,
  activeHeadingId,
  onSelect,
}: {
  items: TocItem[];
  activeHeadingId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();

  if (items.length === 0) return null;

  // Skip the h1 (doc title) — show only h2+ in TOC
  const tocItems = items.filter((item) => item.level >= 2);
  if (tocItems.length === 0) return null;

  return (
    <nav className="w-56 shrink-0 sticky top-0 self-start overflow-y-auto max-h-[calc(100vh-8rem)] py-4 pl-4">
      <h4 className="font-heading text-sm uppercase tracking-wider text-text-muted px-2 py-1.5 mb-2">
        {t("docs.onThisPage")}
      </h4>
      <div className="space-y-0.5 border-l border-neon-cyan/10">
        {tocItems.map((item) => {
          const isActive = item.id === activeHeadingId;
          const indent = item.level === 2 ? "pl-3" : item.level === 3 ? "pl-6" : "pl-9";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`
                w-full text-left py-1.5 ${indent} font-body text-base leading-snug transition-colors duration-150 cursor-pointer truncate
                ${isActive
                  ? "text-neon-cyan border-l-2 border-neon-cyan -ml-px"
                  : "text-text-muted hover:text-text-primary"
                }
              `}
              title={item.text}
            >
              {item.text}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ──────────────── Page component ──────────────── */

export function DocsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const lang = (i18n.language === "zh" ? "zh" : "en") as Lang;

  const [activeHeadingId, setActiveHeadingId] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  const menu = useMemo(() => getDocsTree(lang), [lang]);
  const defaultDocId = menu?.defaultDoc ?? "what-is-ornn";
  const activeId = searchParams.get("section") ?? defaultDocId;

  const markdown = useMemo(() => {
    const content = getDocContent(lang, activeId);
    return content ?? `# ${t("docs.notFound")}\n\nCould not load \`${activeId}\`.`;
  }, [lang, activeId, t]);

  const toc = useMemo(() => extractToc(markdown), [markdown]);

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
        <Sidebar sections={menu?.sections ?? []} activeId={activeId} onSelect={handleSelect} />

        {/* Right — doc content area with TOC minimap */}
        <div className="flex-1 min-w-0 flex min-h-0">
          {/* Main content — scrollable */}
          <div ref={contentRef} className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-6">
            {markdown.includes("<!-- RELEASES -->") ? (
              /* Version Roadmap page: split at placeholder and inject accordion */
              <article className="markdown-body max-w-4xl mx-auto">
                {(() => {
                  const [before, after] = markdown.split("<!-- RELEASES -->");
                  return (
                    <>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={{ code: CodeBlock as never, pre: PreBlock as never, ...headingComponents }}
                      >
                        {before}
                      </ReactMarkdown>
                      <ReleaseAccordion lang={lang} />
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={{ code: CodeBlock as never, pre: PreBlock as never, ...headingComponents }}
                      >
                        {after}
                      </ReactMarkdown>
                    </>
                  );
                })()}
              </article>
            ) : (
              <article className="markdown-body max-w-4xl mx-auto">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    code: CodeBlock as never,
                    pre: PreBlock as never,
                    ...headingComponents,
                  }}
                >
                  {markdown}
                </ReactMarkdown>
              </article>
            )}
          </div>

          {/* TOC minimap — sticky right side */}
          {toc.length > 0 && (
            <TableOfContents
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
