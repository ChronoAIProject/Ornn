#!/usr/bin/env python3
"""
scan_skill.py — Ornn-side wrapper around agentseal.skill_scanner.SkillScanner.

The agentseal `guard` CLI is designed to scan installed agent
configurations on a developer's machine, not arbitrary skill packages.
For the Ornn registry, we want the **library** layer instead — the
`SkillScanner` class — because it's the piece that actually runs
agentseal's threat-detection rules against per-file content.

Usage:
    python scan_skill.py <skill-zip-path>

Behavior:
    1. Extract the ZIP into a temp directory.
    2. Walk every text-like file (SKILL.md, CLAUDE.md, *.md, *.py, *.ts,
       config files, …) up to a sane size cap.
    3. Run `SkillScanner.scan_file(path)` on each.
    4. Aggregate findings + compute a 0–100 trust score by deducting
       severity-weighted penalties from a 100 floor.
    5. Print one JSON line on stdout. Exit 0 on success.

JSON shape (matches what `ornn-api/src/infra/agentseal/index.ts` parses):
    {
      "score": 0–100,
      "findings": [
        {
          "code": str,
          "title": str,
          "severity": "critical"|"high"|"medium"|"low"|"info",
          "description": str,
          "evidence": str,        // truncated to 500 chars
          "remediation": str,
          "file": str             // path relative to the zip root
        },
        ...
      ],
      "scannedFiles": int,
      "agentsealVersion": str,    // e.g. "agentseal-0.9.6"
      "scannedAt": ISO-8601 UTC
    }

On any failure (bad zip, scanner crash, etc.) the script prints
    {"error": "<message>"}
and exits non-zero. The Node-side caller treats both non-zero exit and
JSON without a numeric "score" field as a soft failure (publishes are
never blocked — v1 is warn-only).
"""

import json
import sys
import tempfile
import traceback
import zipfile
from datetime import datetime, timezone
from pathlib import Path

try:
    from agentseal.skill_scanner import SkillScanner
    from agentseal import __version__ as AGENTSEAL_VERSION
except Exception as e:  # pragma: no cover — surfaces in stdout
    print(json.dumps({"error": f"agentseal import failed: {e}"}))
    sys.exit(2)


# Severity → score penalty. Tuned so a single critical finding hurts
# meaningfully but a handful of low/info findings still leave the skill
# in a usable band. Adjust intentionally and bump CHANGELOG when you do
# — score values are persisted on each skill version.
SEVERITY_WEIGHTS = {
    "critical": 25,
    "high": 15,
    "medium": 5,
    "low": 2,
    "info": 1,
}


# Pre-filter by extension so we don't open binary blobs (images, font
# files, compiled wheels, etc.). The SkillScanner does its own per-file
# filtering downstream too, but pre-filtering keeps the walk cheap.
SCAN_EXTS = {
    ".md", ".markdown", ".txt", ".rst",
    ".py", ".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx",
    ".json", ".yaml", ".yml", ".toml",
    ".sh", ".bash", ".zsh",
    ".cfg", ".ini", ".conf",
}

# Extensionless filenames worth scanning anyway.
SCAN_FILENAMES = {
    "SKILL.md", "CLAUDE.md", "AGENTS.md",
    "claude.md", "agents.md", "skill.md",
    ".cursorrules", ".aider.conf.yml", ".env.example",
    "README.md", "readme.md",
}

# Files larger than this are not credible "skill files" — they're more
# likely binary attachments. Match SkillScanner's own 10MB cap loosely.
MAX_FILE_BYTES = 2 * 1024 * 1024


def is_scannable(p: Path) -> bool:
    """True if `p` is a text-like file under the size cap."""
    if not p.is_file():
        return False
    try:
        if p.stat().st_size > MAX_FILE_BYTES:
            return False
    except OSError:
        return False
    if p.name in SCAN_FILENAMES:
        return True
    return p.suffix.lower() in SCAN_EXTS


def scan_directory(scanner: SkillScanner, root: Path) -> dict:
    """Walk `root` recursively and aggregate per-file scan results."""
    findings_out: list[dict] = []
    scanned_count = 0
    for p in sorted(root.rglob("*")):
        if not is_scannable(p):
            continue
        try:
            rel = str(p.relative_to(root))
        except ValueError:
            rel = str(p)
        try:
            result = scanner.scan_file(p)
        except Exception as e:  # pragma: no cover
            findings_out.append({
                "code": "SKILL-SCAN-ERR",
                "title": "Scanner error",
                "severity": "info",
                "description": f"Failed to scan {rel}: {e}",
                "evidence": "",
                "remediation": "",
                "file": rel,
            })
            continue
        scanned_count += 1
        for f in result.findings:
            findings_out.append({
                "code": f.code,
                "title": f.title,
                "severity": f.severity,
                "description": f.description,
                "evidence": (f.evidence or "")[:500],
                "remediation": f.remediation,
                "file": rel,
            })

    score = 100
    for f in findings_out:
        score -= SEVERITY_WEIGHTS.get(f["severity"], 0)
    score = max(0, min(100, score))

    return {
        "score": score,
        "findings": findings_out,
        "scannedFiles": scanned_count,
        "agentsealVersion": f"agentseal-{AGENTSEAL_VERSION}",
        "scannedAt": datetime.now(timezone.utc).isoformat(),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(json.dumps({"error": "usage: scan_skill.py <skill-zip-path>"}))
        return 2

    zip_path = Path(argv[1])
    if not zip_path.exists():
        print(json.dumps({"error": f"zip not found: {zip_path}"}))
        return 2

    try:
        with tempfile.TemporaryDirectory(prefix="agentseal-scan-") as tmpdir:
            tmp = Path(tmpdir)
            try:
                with zipfile.ZipFile(zip_path) as zf:
                    # Defend against zip-slip — refuse any entry that
                    # would extract outside the temp dir.
                    for member in zf.namelist():
                        target = (tmp / member).resolve()
                        if not str(target).startswith(str(tmp.resolve())):
                            print(json.dumps({
                                "error": f"zip-slip in entry: {member}",
                            }))
                            return 2
                    zf.extractall(tmp)
            except zipfile.BadZipFile as e:
                print(json.dumps({"error": f"bad zip: {e}"}))
                return 2

            # Semantic layer requires sentence-transformers + a 90MB
            # ONNX model that doesn't fit a slim runtime image. Pattern
            # + dataflow detection is enough for v1; semantic can be
            # added later by installing `agentseal[semantic]`.
            scanner = SkillScanner(semantic=False)
            result = scan_directory(scanner, tmp)
            print(json.dumps(result, default=str))
            return 0
    except Exception as e:  # pragma: no cover
        print(json.dumps({
            "error": f"scan failed: {e}",
            "traceback": traceback.format_exc(),
        }))
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
