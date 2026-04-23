---
---

`enforce-branch-policy.yml` accepts `release/*` as a legal source branch for PRs → main (for bot release-bump PRs from the changeset-release workflow). `require-review.yml` treats the github-actions bot as a trusted author and drops the stale `aevatarAI/Aevatarians` team reference left over from the pre-transfer repo.
