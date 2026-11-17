#!/usr/bin/env bash
set -euo pipefail
set +x

# Shared by native CI and local smoke builds; this script never exports or publishes.
component=${1:?Requires component}
image=${2:?Requires image}
source_sha=${3:?Requires build revision}
out=${4:?Requires output directory}
mkdir -p "$out"
case "$component" in api|web) ;; *) echo 'Unknown component' >&2; exit 2 ;; esac

if test "$component" = api; then
  # The API needs a database to boot. This qualifies packaging only.
  docker run --rm --platform linux/amd64 --network none --cap-drop ALL \
    --security-opt no-new-privileges:true --entrypoint /bin/sh "$image" -ec '
      test "$(id -u)" = 1000
      test "$(id -g)" = 1000
      test "$(bun --version)" = 1.3.14
      test -r /opt/agentseal/scan_skill.py
      /opt/agentseal/bin/python -c "import agentseal.skill_scanner; from importlib.metadata import version; assert version(\"agentseal\") == \"0.9.6\""
      test -w /app/data
      touch /app/data/staging-ci-write-check
      rm /app/data/staging-ci-write-check
      touch /tmp/staging-ci-write-check
      rm /tmp/staging-ci-write-check
    '
else
  container="ornn-staging-web-smoke-$$"
  cleanup() {
    result=$?
    trap - EXIT
    if test "$result" -ne 0; then
      if ! docker logs "$container" >&2; then
        echo "Failed to read smoke container logs for $container" >&2
      fi
    fi
    if ! docker rm -f "$container" >/dev/null; then
      echo "Failed to remove smoke container $container" >&2
      result=1
    fi
    exit "$result"
  }
  trap cleanup EXIT
  docker run -d --name "$container" --platform linux/amd64 --network none --cap-drop ALL \
    --security-opt no-new-privileges:true \
    -e ORNN_API_BASE_URL=https://staging.example.invalid/api/v1/proxy/s/ornn-api \
    -e NYXID_API_BASE_URL=https://staging.example.invalid \
    -e NYXID_WEB_BASE_URL=https://staging.example.invalid "$image"
  ready=false
  for attempt in $(seq 1 30); do
    if docker exec "$container" wget -q -O /dev/null http://127.0.0.1:8080/health; then
      ready=true
      break
    fi
    echo "Waiting for web health ($attempt/30)"
    sleep 1
  done
  test "$ready" = true
  docker exec "$container" sh -ec '
    test "$(id -u)" = 101
    test "$(id -g)" = 101
    wget -q -O /dev/null http://127.0.0.1:8080/
    wget -q -O - http://127.0.0.1:8080/config.js | grep -F https://staging.example.invalid/api/v1/proxy/s/ornn-api
    test ! -e /usr/share/nginx/html/config.js.template
  '
  docker exec "$container" wget -q -O - http://127.0.0.1:8080/version.json > "$out/version.json"
  export source_sha out
  python3 - <<'PY'
import json, os
from pathlib import Path
data = json.loads((Path(os.environ['out']) / 'version.json').read_text())
package = json.loads(Path('ornn-web/package.json').read_text())
expected = {'version': package['version'] + '+' + os.environ['source_sha']}
if data != expected:
    raise ValueError(f'Unexpected web build version: {data}; expected {expected}')
PY
fi
echo "Passed network-disabled $component packaging smoke for $source_sha"
