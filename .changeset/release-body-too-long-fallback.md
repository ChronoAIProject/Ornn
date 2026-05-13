---
---

CI: harden the `changeset-release` workflow against GitHub's 125 000-char release-body limit. Big releases like v0.6.0 (87 consumed changesets) used to fail the `Create tag + GitHub Release` step; the workflow now falls back to a short body linking to the in-repo CHANGELOGs when the inline body would exceed the cap.
