---
"ornn-web": patch
---

Render Mermaid SVG inside a sandboxed iframe (#440). The DocsPage previously injected the rendered SVG via `dangerouslySetInnerHTML`. Mermaid is the only producer today and its input is trusted in-repo markdown, so this is purely defence-in-depth — but if any future code path ever feeds user-controlled diagram source (e.g. user-authored skill READMEs with mermaid blocks), the strict `sandbox=""` boundary already prevents script execution, form submission, navigation, and storage access. The lightbox pan/zoom transform is owned by the parent `<div>`, so interaction is unchanged.
