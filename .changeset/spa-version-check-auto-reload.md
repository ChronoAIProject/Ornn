---
"ornn-web": minor
---

SPA stale-bundle self-recovery. Every build emits `dist/version.json` and bakes the same `<pkg.version>+<git-short-sha>` string into `__APP_VERSION__`. At runtime the SPA polls `/version.json` every 60s + on tab focus / visibility change; when the deployed version differs from the baked one a small ember-stamp banner pinned to the top of the viewport offers a one-click reload. Users on stale tabs / aggressively-cached browsers (Safari) recover without being told to clear cache.

Failure-tolerant: any network / parse / 404 path returns `null` silently — we'd rather under-prompt than spam.

Operator change: `docker build` for ornn-web now needs `--build-arg GIT_COMMIT=$(git rev-parse --short HEAD)` so the deployed bundle has a real commit-pinned identity. CLAUDE.md Step 6 updated to match.

Closes #318.
