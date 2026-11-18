"""Bounded, offline whole-bundle syntax proof for scoped classifications."""

import json
import os
from pathlib import Path
import subprocess

MAX_BUNDLE_BYTES = 16 * 1024 * 1024
RUNNER = Path(__file__).with_name("bundle_syntax.cjs")


def proven_findings(payload, findings):
    """Any unsupported input/tool failure leaves exact-file matching unaffected."""
    if not payload or len(payload) > MAX_BUNDLE_BYTES:
        return set()
    try:
        request = {"text": payload.decode("utf-8"), "findings": [
            {key: finding.get(key) for key in ("finding_id", "candidate_sha256", "line")}
            for finding in findings
        ]}
        # Do not let Node options preload code or load a different parser.
        env = {k: v for k, v in os.environ.items() if k not in {"NODE_OPTIONS", "NODE_PATH"}}
        result = subprocess.run(
            ["node", "--max-old-space-size=512", str(RUNNER)],
            input=json.dumps(request, ensure_ascii=False).encode("utf-8"),
            capture_output=True, timeout=30, check=False, env=env,
        )
        if result.returncode:
            return set()
        proven = json.loads(result.stdout)
        if (not isinstance(proven, list) or not all(isinstance(x, str) for x in proven)
                or not set(proven) <= {f["finding_id"] for f in findings}):
            return set()
        return set(proven)
    except (OSError, UnicodeError, ValueError, subprocess.TimeoutExpired):
        return set()
