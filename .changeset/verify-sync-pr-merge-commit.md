---
"ornn-api": patch
"ornn-web": patch
---

Smoke test for PR #141 — forces a v0.3.2 patch bump so the release state machine can exercise the new direct-API merge path. After this ships, `git show` on the sync commit should list two parents and `git merge-base origin/main origin/develop` should equal `origin/main`'s HEAD.
