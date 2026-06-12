---
"ornn-web": minor
---

Skillset detail graph: switched read-only rendering from Mermaid to the react-flow canvas (proper canvas engine, same as editor) for much better space utilization, layout, pan/zoom and hover support. Removed the old direct-mermaid hover code. 

Hover dialog for package preview is now larger (wider/taller, better padding/shadow).

Version auto-increaser in edit: removed patch button (and default now uses minor bump); only +minor / +major remain.

All per latest feedback. Tests/build updated.