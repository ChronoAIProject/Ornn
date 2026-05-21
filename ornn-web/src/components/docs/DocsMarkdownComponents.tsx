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

import { useRef, useState } from "react";
import { MermaidBlock } from "./DocsMermaid";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

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

/**
 * Component map to pass into `<ReactMarkdown components={...}>`.
 * Renames `pre`/`code` and injects slug IDs on h1-h4.
 */
export const markdownComponents = {
  pre: PreBlock,
  code: CodeBlock,
  h1: H1,
  h2: H2,
  h3: H3,
  h4: H4,
};
