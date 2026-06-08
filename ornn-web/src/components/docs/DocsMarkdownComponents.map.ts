/**
 * Component map for `<ReactMarkdown components={...}>`.
 *
 * Split out of DocsMarkdownComponents.tsx so that file only exports
 * components — required for react-refresh / Fast Refresh (#888). This
 * `.ts` module carries the non-component object export.
 *
 * Renames `pre`/`code` and injects slug IDs on h1-h4.
 *
 * @module components/docs/DocsMarkdownComponents.map
 */

import { PreBlock, CodeBlock, H1, H2, H3, H4 } from "./DocsMarkdownComponents";

export const markdownComponents = {
  pre: PreBlock,
  code: CodeBlock,
  h1: H1,
  h2: H2,
  h3: H3,
  h4: H4,
};
