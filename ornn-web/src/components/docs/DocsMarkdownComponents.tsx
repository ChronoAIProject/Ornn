/**
 * react-markdown custom component map extracted from DocsPage (#453).
 *
 * Exports a single `markdownComponents` object that DocsPage spreads
 * into `<ReactMarkdown components={...}>` plus the slug helper used by
 * the headings. The TOC needs the same `slugify` (heading IDs must
 * match the TOC entries), so it lives next to the heading components.
 *
 * Wraps `pre` with a CopyButton, swaps ` ```mermaid ` blocks to
 * MermaidBlock, and injects `id={slug}` onto every h1-h4 so the
 * sticky TOC's #-anchor links work.
 *
 * @module components/docs/DocsMarkdownComponents
 */

import { useState } from "react";
import { MermaidBlock } from "./DocsMermaid";
import { slugify, extractTextFromChildren } from "./DocsMarkdownComponents.helpers";

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
      className="absolute top-2 right-2 z-10 px-2 py-1 rounded text-xs font-mono transition-all cursor-pointer border border-accent/30 bg-page/80 text-meta hover:text-accent hover:border-accent/60"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/** Wraps <pre> blocks with a relative container and copy button outside the scrollable area */
function PreBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  // Pure derivation from props — no ref needed. The copy text is the
  // flattened text content of the <code> child with a trailing newline
  // stripped (markdown code fences carry one).
  const codeText = extractTextFromChildren(children).replace(/\n$/, "");

  return (
    <div className="relative">
      <CopyButton text={codeText} />
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
  // Capture group 1 is always present on match. `!` is safe under
  // noUncheckedIndexedAccess (#450).
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

// The `markdownComponents` map (assembled from these components) lives
// in the sibling `DocsMarkdownComponents.map.ts` so this file only
// exports components — keeping react-refresh's Fast Refresh boundary
// intact (#888).
export { PreBlock, CodeBlock, H1, H2, H3, H4 };
