#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-${ORNN_API_BASE_URL:-http://localhost:3802}}"
base_url="${base_url%/}"

case "$base_url" in
  http://localhost:*|http://localhost/*|http://127.0.0.1:*|http://127.0.0.1/*|http://[::1]:*|http://[::1]/*) ;;
  *)
    echo "ornn-fkst: API base URL must be local http" >&2
    exit 2
    ;;
esac

for path in /livez /health /readyz /api/v1/openapi.json; do
  curl -fsS --max-time 10 "$base_url$path" >/dev/null
done
