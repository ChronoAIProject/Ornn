#!/usr/bin/env bash
#
# Prepare a release on develop.
#
# What it does (in order):
#   1. Fetches origin and fast-forwards local develop.
#   2. Confirms there are pending changesets to consume.
#   3. Creates (or resets) branch `release/version-packages` off develop.
#   4. Runs `bun run version-packages` — consumes `.changeset/*.md`, bumps
#      `ornn-api/package.json` + `ornn-web/package.json`, appends CHANGELOG.md
#      entries.
#   5. Commits the bump.
#   6. Force-pushes the branch.
#   7. Opens (or updates) a PR `release/version-packages → develop`.
#
# After that PR merges:
#   - Open a second PR: `develop → main`
#   - Merging that triggers `.github/workflows/changeset-release.yml`,
#     which tags the release and creates GitHub Releases.
#
# Usage: bun run release:prep
# Requires: gh CLI authed against the repo.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BRANCH="release/version-packages"

# 1. sync develop
git fetch origin
git checkout develop
git pull --ff-only

# 2. any pending?
PENDING=$(find .changeset -name "*.md" ! -name "README.md" 2>/dev/null | wc -l | xargs)
if [ "$PENDING" = "0" ]; then
  echo "No pending changesets. Nothing to release."
  exit 0
fi
echo "Found $PENDING pending changesets. Preparing release branch..."

# 3. branch
git checkout -B "$BRANCH"

# 4. consume + bump
bun run version-packages

# 5. capture new version (ornn-api and ornn-web are fixed-linked, same version)
VERSION=$(node -p "require('./ornn-api/package.json').version")
echo "New version: v${VERSION}"

# 6. commit + push
git add -A
git commit -m "chore: version packages → v${VERSION}"
git push -fu origin "$BRANCH"

# 7. open (or report) PR
EXISTING_PR=$(gh pr list --head "$BRANCH" --base develop --state open --json number --jq '.[0].number // empty')
if [ -n "$EXISTING_PR" ]; then
  echo "PR #${EXISTING_PR} already open for ${BRANCH} — force-pushed latest."
else
  gh pr create \
    --base develop \
    --head "$BRANCH" \
    --title "chore: version packages → v${VERSION}" \
    --body "Automated by \`bun run release:prep\`. Consumes ${PENDING} pending changesets, bumps to v${VERSION}."
fi

cat <<EOF

✅ Release branch ready.
Next steps:
  1. Review + merge the release PR on develop.
  2. Open PR: develop → main
  3. Merging to main auto-tags and creates GitHub Releases (via changeset-release workflow).
EOF
