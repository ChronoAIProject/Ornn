---
---

Harden the release-flow trust boundary. New `.github/CODEOWNERS` requires maintainer review on workflow files, CODEOWNERS itself, changeset config, package manifests, Dockerfiles, nginx config, and `deployment/`. `changeset-release.yml` adds a hard pre-merge assertion that the auto-merged PR's head branch matches `sync/post-release-v*`, base is `develop`, and author is the github-actions bot — so the auto-merge path can never drift into a different PR shape by mistake.
