---
"ornn-web": patch
---

Decompose DocsPage into 5 colocated components (#453).

`pages/DocsPage.tsx`: **905 → 303 lines (−67%)**, just over the issue's 300-line target. Five new components under `components/docs/`:

- `DocsMermaid` (244L) — MermaidBlock + MermaidLightbox + SandboxedSvg + per-theme palettes
- `DocsMarkdownComponents` (139L) — `markdownComponents` object for `<ReactMarkdown components={...}>` plus the shared `slugify()` helper
- `DocsReleaseAccordion` (139L) — ReleaseAccordion + VersionBadge
- `DocsSidebar` (112L) — collapsible left rail
- `DocsTableOfContents` (69L) — sticky right minimap

DocsPage now only carries page state (active doc, scroll-spy active heading, frontmatter parse, copy-doc handler) and the layout shell. Behavior unchanged; 110 web tests still pass.

Second PR under #453 (after SkillDetailPage in #651). PlaygroundPage (813L) still pending its own PR.
