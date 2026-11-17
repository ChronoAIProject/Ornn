#!/usr/bin/env bash
set +x
set -euo pipefail
umask 077
scanner_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$scanner_dir"
# Includes Docker-loaded clean/fake-key images; never runs a fixture container.
exec "${PYTHON:-python3}" -m unittest discover -s tests -v
