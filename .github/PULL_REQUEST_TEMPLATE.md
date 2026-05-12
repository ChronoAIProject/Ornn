<!--
  Thanks for opening a PR! Fill out the sections below so the reviewer has
  what they need. PRs missing an issue link or a changeset will be held until
  both are added. See CONTRIBUTING.md for the full guide.
-->

## Summary

<!-- 1–3 sentences: what changes and why. The body explains, the title doesn't. -->

## Linked issue

<!--
  Required. Use one of: Closes #N, Fixes #N, Resolves #N.
  Prose like "this addresses #N" does NOT auto-close the issue.
  If no issue exists yet, stop and open one first — every PR must link one.
-->

Closes #

## Type of change

<!-- Tick all that apply. -->

- [ ] Bug fix (`fix:`)
- [ ] New feature (`feat:`)
- [ ] Refactor (`refactor:`) — no behaviour change
- [ ] Docs (`docs:`)
- [ ] CI / build / infra (`chore(ci):`, `chore(infra):`)
- [ ] Breaking change

## Commit decomposition

<!--
  Multiple small self-contained commits > one big combined commit. See
  CONTRIBUTING.md → "Commit standards".
-->

- [ ] Each commit is self-contained (a reviewer can understand it from the diff + message alone).
- [ ] Each commit is small (one logical change).
- [ ] Refactors are separated from behaviour changes.
- [ ] No `Co-Authored-By` trailers.

## Changeset

<!-- CI blocks PRs without a changeset file under .changeset/. -->

- [ ] Added a changeset (`bun changeset`) — describe the user-facing impact.
- [ ] Or this PR is docs-only / CI-only and uses an empty changeset (`bun changeset --empty`).

## Testing

<!-- How was this verified? Unit tests, integration tests, manual QA, screenshots? -->

## Screenshots / recordings

<!-- For visual / UI changes. Remove this section otherwise. -->

## Notes for the reviewer

<!-- Anything non-obvious: tradeoffs considered, deferred follow-ups, related PRs. -->
