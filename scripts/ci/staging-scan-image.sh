#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

case "${COMPONENT:-}" in api|web) ;; *) echo 'Unknown image component' >&2; exit 2 ;; esac
out=staging-image-out
archive="$out/ornn-${COMPONENT}-linux-amd64.docker.tar.gz"
archive_sha=$(python3 -c 'import json; print(json.load(open("staging-image-out/metadata.json"))["archiveSha256"])')
scan_root=$(mktemp -d "${RUNNER_TEMP:-/tmp}/ornn-image-preflight.XXXXXX")
trap 'rm -rf -- "$scan_root"' EXIT
# Preserve the strict plaintext-gzip and path boundary checks alongside the
# shared policy. This stage never rewrites the saved artifact.
python3 scripts/ci/staging_scan_inputs.py "$archive" "$scan_root/input" \
  --receipt "$out/scan-preflight.json" --expected-archive-sha256 "$archive_sha"
rm -rf -- "$scan_root"
trap - EXIT
# Scan the existing export without rebuilding, filtering, or rewriting image bytes.
# Both findings (1) and incomplete/error (2) stop before archive upload or push.
bash scripts/ci/image-secret-scan/scan-image-secrets.sh "$archive" \
  --input-kind archive --output "$out/secret-scan" \
  --allowlist scripts/ci/ornn-image-allowlist.json \
  --expected-archive-sha256 "$archive_sha"
python3 scripts/ci/staging_image.py scan
