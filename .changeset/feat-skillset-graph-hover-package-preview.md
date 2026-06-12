---
"ornn-web": minor
---

Skillset detail: the member dependencies graph (Mermaid) now occupies the full vertical space in the left column (permanent package viewer below it has been removed). Hovering a node in the graph shows a floating dialog containing the package preview for that skill (reuses the compact path of SkillsetMemberViewer). 

To enable node hover detection the read-only graph now renders the Mermaid SVG directly (trusted source) instead of the sandboxed iframe, and MermaidBlock gained `direct` + `onNodeHover` support for this. Layout comments and one affected page test updated. The graph canvas is now fully utilized while the package viewer UX is preserved on-demand via hover.