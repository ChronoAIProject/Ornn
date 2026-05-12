<!--
@claude / future-me, before opening the next develop → main release PR:

  1. Read every file under `.changeset/*.md` (these get consumed at
     release time). Also skim the bits of `ornn-api/CHANGELOG.md` and
     `ornn-web/CHANGELOG.md` that landed since the previous tag if you
     want extra context.
  2. Replace each `(write here)` block below with a brief, user-facing
     summary. Drop an entire section if there's nothing for it.

Style rules:

  - One bullet = one product-level fact a user / agent developer
    actually cares about. 6–12 words. Plain prose.
  - Cluster purely-technical items (refactors, dep bumps, infra / CI,
    type fixes, internal renames) into a single trailing bullet per
    section:
      Fixed       → "Few technical bugs fixed"
      New Feature → "Technical enhancement"
      Changed     → "Technical enhancement"
    Don't expand the technical bucket into individual bullets.
  - No PR / issue refs, no version numbers, no author thanks, no
    "see #N" links. The CHANGELOG link at the bottom of the
    auto-generated release body already covers all of that.
  - English only. Tight.
  - If a section ends up with only the technical-bucket bullet, that's
    fine — keep it. If a section ends up with zero bullets (genuinely
    nothing happened in that bucket), delete the whole section
    including its heading.

How this file is used by the release workflow:

  - `.github/workflows/changeset-release.yml` State B reads this file.
  - If the file is missing OR still contains the literal string
    `(write here)`, the workflow falls back to a short body that
    links to the in-repo CHANGELOGs (release still publishes, just
    without custom prose).
  - Otherwise the file's content below this comment block is used as
    the GitHub Release body, with the CHANGELOG-link footer appended.

After release, leave this file's content as-is or replace it ahead of
the next release. The workflow doesn't care about post-release state.
-->

## Fixed

- (write here)

## New Feature

- (write here)

## Changed

- (write here)
