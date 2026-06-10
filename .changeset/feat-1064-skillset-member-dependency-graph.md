---
"ornn-web": minor
---

Skillset member-dependency graph (#1064). A skillset author can now declare a "runs before" dependency graph between member skills, visualised with Mermaid. In the create/publish form, a new dependency-graph editor sits between the member picker and the master prompt: click a member, then another, to draw an edge; edges show as removable chips with a live diagram preview and a non-blocking advisory when the members form a cycle. The skillset detail page renders the graph read-only (with pan / zoom / lightbox) under a "Member dependencies" section, with an empty state when no dependencies are declared.

Edges are persisted ENTIRELY inside the skillset's master prompt (`instructions`) as a single managed, comment-fenced Mermaid block — no new backend field, no new API call, and no change to any member skill's metadata or package. The graph is a pure projection of the one `instructions` state: the codec preserves the author's prose byte-for-byte across round-trips and treats any absent / unknown / garbled block as "no edges", so it is forward-compatible and never corrupts a prompt. Distinct from the #968 skill-intrinsic dependency closure. New copy is keyed under the `skillsetGraph` i18n namespace in English and Chinese. No new runtime dependency — reuses the already-installed Mermaid renderer.
