#!/usr/bin/env bash
# Never enable shell tracing here: arguments can identify private image sources.
set +x
set -euo pipefail
umask 077
scanner_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python_executable=${PYTHON:-python3}
if ! command -v "$python_executable" >/dev/null 2>&1; then
    printf '%s\n' '{"status":"ERROR","error":"python-unavailable"}' >&2
    exit 2
fi
exec "$python_executable" "$scanner_dir/scan_image_secrets.py" "$@"
