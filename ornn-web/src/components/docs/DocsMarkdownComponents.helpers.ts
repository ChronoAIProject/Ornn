/**
 * Pure helpers for the docs markdown renderer.
 *
 * Kept in a sibling module (not the .tsx) so the component file only
 * exports components — required for react-refresh / Fast Refresh to
 * work without resetting component state on every edit (#888).
 *
 * `slugify` is shared with the TOC builder in DocsPage; heading IDs must
 * match the TOC entries, so both sides import the exact same function.
 *
 * @module components/docs/DocsMarkdownComponents.helpers
 */

import type { ReactNode } from "react";

/** Normalise heading text into a stable URL-anchor slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Recursively flatten a React node tree into its plain text content. */
export function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("");
  if (children && typeof children === "object" && "props" in children) {
    const el = children as { props?: { children?: ReactNode } };
    return extractTextFromChildren(el.props?.children);
  }
  return "";
}
