---
---

Publishes `docs/ERRORS.md` and `docs/DEPRECATIONS.md` (#576) — the GitHub-anchored catalogs that `application/problem+json` `type` URLs and `Link: rel="deprecation"` headers point at. `ERRORS.md` documents all ten target `lowercase_snake_case` codes with `##` headings (so anchors resolve) and lists every `SCREAMING_SNAKE_CASE` code currently emitted in an appendix mapping table, owned by the #585 case migration. `DEPRECATIONS.md` ships empty (alpha = no deprecation cycle yet) with the entry template ready for v1. `CONVENTIONS.md` `type` and `Link` example URLs updated to point at the new paths.
