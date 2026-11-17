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
# Findings may be assessed against the reviewed catalog; scanner errors never are.
scan_rc=0
bash scripts/ci/image-secret-scan/scan-image-secrets.sh "$archive" \
  --input-kind archive --output "$out/secret-scan-raw" \
  --blocking-rules credential \
  --allowlist scripts/ci/ornn-image-allowlist.json \
  --expected-archive-sha256 "$archive_sha" || scan_rc=$?
case "$scan_rc" in 0|1) ;; *) exit "$scan_rc" ;; esac
review_args=(--proposal)
if test -f scripts/ci/ornn-content-policy-review.json; then
  review_args=(--review scripts/ci/ornn-content-policy-review.json)
fi
# An unreviewed proposal always exits nonzero and cannot produce a CLEAN receipt.
python3 scripts/ci/content-policy/tool/resolve_content_policy.py \
  --scanner scripts/ci/image-secret-scan --archive "$archive" \
  --report "$out/secret-scan-raw/REPORT.json" \
  --catalog scripts/ci/ornn-content-policy.json --component "$COMPONENT" \
  --output "$out/secret-scan" "${review_args[@]}"
python3 scripts/ci/staging_image.py scan
