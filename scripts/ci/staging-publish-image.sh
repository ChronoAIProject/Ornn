#!/usr/bin/env bash
set -euo pipefail
set +x

python3 scripts/ci/staging_image.py guard publish
out=staging-image-out
image_id=$(python3 scripts/ci/staging_image.py archive)
package="ghcr.io/chronoaiproject/ornn-staging-${COMPONENT}"
target="${package}:${GITHUB_SHA}"

echo "Load verified $COMPONENT archive for revision $GITHUB_SHA"
docker image load --input "$out/ornn-${COMPONENT}-linux-amd64.docker.tar.gz"
docker image inspect "$image_id" > "$out/loaded-inspect.json"
python3 scripts/ci/staging_image.py loaded
# Tag by the verified engine image ID, never by an archive-supplied mutable tag.
docker image tag "$image_id" "$target"

# Credentials live only in this job's temporary directory and are removed on exit.
: "${DOCKER_CONFIG:?Requires an isolated Docker config directory}"
mkdir -p "$DOCKER_CONFIG"
cleanup() {
  rm -f "$DOCKER_CONFIG/config.json"
}
trap cleanup EXIT
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GITHUB_ACTOR" --password-stdin
unset GHCR_TOKEN
echo "Publish $target"
docker image push --quiet "$target" > "$out/push-digest.txt"
digest=$(cat "$out/push-digest.txt")
if ! [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo 'Invalid digest returned by docker push' >&2
  exit 1
fi
# Read the immutable registry manifest back and verify its config digest.
docker manifest inspect "$package@$digest" > "$out/remote-manifest.json"
python3 scripts/ci/staging_image.py publication
