#!/usr/bin/env bash
set -euo pipefail
set +x

python3 scripts/ci/staging_image.py guard publish
# Credentials live only in this job's temporary directory and are removed on exit.
: "${DOCKER_CONFIG:?Requires an isolated Docker config directory}"
mkdir -p "$DOCKER_CONFIG"
cleanup() {
  rm -f "$DOCKER_CONFIG/config.json"
}
trap cleanup EXIT
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GITHUB_ACTOR" --password-stdin
unset GHCR_TOKEN
python3 scripts/ci/staging_publish.py
python3 scripts/ci/staging_image.py publication
