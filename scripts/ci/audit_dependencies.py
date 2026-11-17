"""Run the dependency audit with expiring, exact-input exceptions."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ADVISORY = re.compile(r"GHSA-[23456789cfghjmpqrvwx]{4}(?:-[23456789cfghjmpqrvwx]{4}){2}")
# Existing accepted risks remain documented in ci.yml and issues #385 / #1219.
EXISTING_IGNORES = (
    "GHSA-r5fr-rjxr-66jc", "GHSA-f23m-r3pf-42rh", "GHSA-qwww-vcr4-c8h2",
)
REQUIRED_INPUTS = {
    "package.json", "bun.lock", "ornn-api/package.json",
    "ornn-web/package.json", "sdk/typescript/package.json",
    "ornn-api/Dockerfile.staging", "ornn-web/Dockerfile.staging",
}


def exception_ids(config, repository, now):
    if config.get("schema") != "ornn-audit-exceptions-v1":
        raise ValueError("Unknown audit exception schema")
    entries = config.get("exceptions")
    if not isinstance(entries, list):
        raise ValueError("Audit exceptions must be a list")
    accepted = []
    for entry in entries:
        advisory = entry["advisory"]
        if not isinstance(advisory, str) or not ADVISORY.fullmatch(advisory):
            raise ValueError("Invalid audit advisory ID")
        if advisory in accepted or advisory in EXISTING_IGNORES:
            raise ValueError("Duplicate audit advisory ID")
        for field in ("package", "version", "justification", "tracking_issue"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError("Missing audit exception rationale")
        expires = datetime.fromisoformat(entry["expires_at"])
        if expires.tzinfo is None or now >= expires:
            raise ValueError(f"Audit exception expired or lacks timezone: {advisory}")
        inputs = entry["input_sha256"]
        if not isinstance(inputs, dict) or not REQUIRED_INPUTS <= inputs.keys():
            raise ValueError("Missing dependency inputs for audit exception")
        for name, expected in inputs.items():
            if not isinstance(name, str) or not isinstance(expected, str):
                raise ValueError("Invalid audit input digest")
            path = Path(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name:
                raise ValueError("Invalid audit input path")
            source = repository / path
            if source.is_symlink() or not source.resolve().is_relative_to(repository.resolve()):
                raise ValueError("Audit input must stay inside the repository")
            if not re.fullmatch(r"[0-9a-f]{64}", expected):
                raise ValueError("Invalid audit input digest")
            if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
                raise ValueError(f"Audit exception inputs changed: {advisory}")
        print(f"Audit exception {advisory} expires {expires.isoformat()}", flush=True)
        accepted.append(advisory)
    return accepted


def audit_command(exceptions):
    return ["bun", "audit", "--audit-level=high", *(
        f"--ignore={advisory}" for advisory in (*EXISTING_IGNORES, *exceptions)
    )]


def main():
    try:
        config = json.loads((ROOT / ".github/audit-exceptions.json").read_text())
        exceptions = exception_ids(config, ROOT, datetime.now(timezone.utc))
        # Preserve nonzero audit/scanner/network errors and all other advisories.
        return subprocess.run(audit_command(exceptions), cwd=ROOT, check=False).returncode
    except (KeyError, TypeError, ValueError, OSError):
        print("Audit failed: invalid, expired or changed exception inputs", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
