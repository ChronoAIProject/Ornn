#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FKST_PACKAGES_TESTING_ROOT="${FKST_PACKAGES_TESTING_ROOT:-/Users/hayleewang/Documents/Projects/fkst-packages-testing}"
PACKAGE_ROOT="$ROOT/testing/fkst/ornn-native-full"
ORNN_API_BASE_URL="${ORNN_API_BASE_URL:-http://localhost:3802}"
ORNN_WEB_BASE_URL="${ORNN_WEB_BASE_URL:-http://localhost:5173}"
ORNN_CDP_URL="${ORNN_CDP_URL:-http://127.0.0.1:9222}"
ORNN_FKST_PROFILE="${ORNN_FKST_PROFILE:-public}"
ORNN_COMPOSE_PROJECT_NAME="${ORNN_COMPOSE_PROJECT_NAME:-ornn}"

export ORNN_API_BASE_URL ORNN_WEB_BASE_URL ORNN_CDP_URL ORNN_FKST_PROFILE ORNN_COMPOSE_PROJECT_NAME

fail() {
  echo "ornn-fkst: $*" >&2
  exit 1
}

require_dir() {
  [ -d "$1" ] || fail "missing directory: $1"
}

if [ "$ORNN_FKST_PROFILE" != "public" ]; then
  fail "only ORNN_FKST_PROFILE=public is enabled; auth/admin require safe host session fixtures"
fi

require_dir "$FKST_PACKAGES_TESTING_ROOT"
require_dir "$PACKAGE_ROOT"

wait_url() {
  local url="$1" label="$2" attempt
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 5 "$url" >/dev/null; then
      echo "ornn-fkst: ready $label $url"
      return 0
    fi
    sleep 2
  done
  fail "timed out waiting for $label at $url"
}

resolve_bin() {
  if [ -n "${BIN:-}" ] && [ -x "$BIN" ]; then
    printf '%s\n' "$BIN"
    return 0
  fi

  if [ -f "$FKST_PACKAGES_TESTING_ROOT/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    . "$FKST_PACKAGES_TESTING_ROOT/.env"
    set +a
    if [ -n "${BIN:-}" ] && [ -x "$BIN" ]; then
      printf '%s\n' "$BIN"
      return 0
    fi
  fi

  if command -v fkst-framework >/dev/null 2>&1; then
    command -v fkst-framework
    return 0
  fi

  local sibling="$FKST_PACKAGES_TESTING_ROOT/../fkst-substrate/target/debug/fkst-framework"
  if [ -x "$sibling" ]; then
    printf '%s\n' "$sibling"
    return 0
  fi

  local bootstrap="$FKST_PACKAGES_TESTING_ROOT/.fkst/run/fkst-packages-conformance/scripts/bin_bootstrap.sh"
  if [ -f "$bootstrap" ]; then
    # shellcheck source=/dev/null
    . "$bootstrap"
    if resolve_bin_contract "$FKST_PACKAGES_TESTING_ROOT" "bootstrap"; then
      printf '%s\n' "$RESOLVED_BIN"
      return 0
    fi
  fi

  fail "set BIN to an executable fkst-framework or run $FKST_PACKAGES_TESTING_ROOT/scripts/run.sh test testing-runner once"
}

copy_tree() {
  local src="$1" dest="$2" exclude_tests="${3:-0}"
  mkdir -p "$dest"
  if [ "$exclude_tests" = "1" ]; then
    (cd "$src" && LC_ALL=C tar --exclude './tests' --exclude './tests/*' --exclude 'tests' --exclude 'tests/*' -cf - .) | (cd "$dest" && LC_ALL=C tar xf -)
    rm -rf "$dest/tests"
  else
    (cd "$src" && LC_ALL=C tar -cf - .) | (cd "$dest" && LC_ALL=C tar xf -)
  fi
}

build_workspace() {
  local work lib pkg
  work="$(mktemp -d "${TMPDIR:-/tmp}/ornn-fkst-native.XXXXXX")"
  mkdir -p "$work/packages" "$work/libraries"
  cat > "$work/fkst.workspace.toml" <<'TOML'
[workspace]
units = ["packages/*", "libraries/*"]
packages = ["packages/*"]
libraries = ["libraries/*"]

[registries]
workspace = "workspace"
TOML

  for lib in "$FKST_PACKAGES_TESTING_ROOT"/libraries/*/; do
    [ -d "$lib" ] || continue
    copy_tree "${lib%/}" "$work/libraries/$(basename "$lib")" 0
  done

  copy_tree "$PACKAGE_ROOT" "$work/packages/ornn-native-full" 0
  for pkg in browser-readiness testing-pipeline module-test-loop testing-runner test-artifacts test-publication; do
    copy_tree "$FKST_PACKAGES_TESTING_ROOT/packages/$pkg" "$work/packages/$pkg" 1
  done
  printf '%s\n' "$work"
}

run_fkst_profile_tests() {
  local bin="$1" work="$2"
  "$bin" test \
    --project-root "$work" \
    --package-root "$work/packages/ornn-native-full" \
    --package-root "$work/packages/browser-readiness" \
    --package-root "$work/packages/testing-pipeline" \
    --package-root "$work/packages/module-test-loop" \
    --package-root "$work/packages/testing-runner" \
    --package-root "$work/packages/test-artifacts" \
    --package-root "$work/packages/test-publication"
}

cd "$ROOT"

echo "ornn-fkst: starting Docker Compose services"
docker compose -p "$ORNN_COMPOSE_PROJECT_NAME" up --build -d mongodb minio ornn-api ornn-web

wait_url "${ORNN_API_BASE_URL%/}/livez" "api livez"
wait_url "${ORNN_API_BASE_URL%/}/readyz" "api readyz"
wait_url "${ORNN_WEB_BASE_URL%/}/" "web"

"$PACKAGE_ROOT/bin/ornn-api-public-smoke.sh" "$ORNN_API_BASE_URL"

BIN="$(resolve_bin)"
WORK="$(build_workspace)"
trap 'rm -rf "$WORK"' EXIT

echo "ornn-fkst: running FKST-native profile tests"
run_fkst_profile_tests "$BIN" "$WORK"

echo "ornn-fkst: complete; artifacts are under $ROOT/.testing/runs/ornn-*"
