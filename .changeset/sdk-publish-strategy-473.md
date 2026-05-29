---
---

Publishes `docs/SDK_PUBLISHING.md` (#473) — explicit decision to hold both `@chronoai/ornn-sdk` (npm) and `ornn-sdk` (PyPI) for v1.0 so the surface stops shifting under early adopters during alpha. Adds a v1 publish checklist (drop `private: true`, reserve registry names, extend changeset-release workflow with `npm publish` + `twine upload`, smoke-test on a clean machine) and a "pre-publish install from source" recipe for current users (`bun link` for TS, `pip install -e` / git-subdirectory for Python). Both SDK READMEs gain a "Status: pre-publish" banner pointing at the doc.
