"""Measure local-to-job detector reuse; never restore/export a shared PR cache."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time


PARITY = ("archive_sha256", "complete", "status", "inventory", "scanned_bytes", "counts",
          "findings", "allowlisted", "blocking_findings", "advisory_findings")


def check_parity(warm, fresh, stable_files):
    if not warm["complete"] or any(warm.get(key) != fresh.get(key) for key in PARITY):
        raise ValueError("Cached scan differs from complete fresh scan")
    stats = warm["detector_cache"]
    if stats["hits"] < stable_files or stats["misses"] < 1 or stats["invalid"]:
        raise ValueError("Expected stable-file hits and a newly scanned app edit")
    return stats


def run(first, second, output):
    output.mkdir(exist_ok=True)
    commands = []
    with tempfile.TemporaryDirectory(prefix="ornn-layer-scan-") as folder:
        cache = Path(folder) / "detector-cache.json"
        reports = {}
        for mode, archive in [("cold", first), ("warm", second), ("fresh", second)]:
            destination = output / mode
            with archive.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            command = ["bash", "scripts/ci/image-secret-scan/scan-image-secrets.sh", str(archive),
                       "--input-kind", "archive", "--output", str(destination),
                       "--blocking-rules", "credential", "--allowlist", "scripts/ci/ornn-image-allowlist.json",
                       "--expected-archive-sha256", digest]
            if mode == "cold":
                command += ["--detector-cache-output", str(cache)]
            elif mode == "warm":
                command += ["--detector-cache", str(cache)]
            start = time.monotonic()
            result = subprocess.run(command, check=False)
            if result.returncode not in (0, 1):
                raise ValueError("Scanner did not complete")
            reports[mode] = json.loads((destination / "REPORT.json").read_text())
            subprocess.run([
                "python3", "scripts/ci/content-policy/tool/resolve_content_policy.py",
                "--scanner", "scripts/ci/image-secret-scan", "--archive", str(archive),
                "--report", str(destination / "REPORT.json"),
                "--catalog", "scripts/ci/ornn-content-policy.json", "--component", "api",
                "--output", str(output / (mode + "-resolved")),
                "--review", "scripts/ci/ornn-content-policy-review.json",
            ], check=True)
            commands.append({"mode": mode, "seconds": time.monotonic() - start,
                             "detector_cache": reports[mode].get("detector_cache")})
        proof = json.loads((output.parent / "RESULT.json").read_text())
        stable_files = sum(row["files"] for row in proof["first"][:-1])
        stats = check_parity(reports["warm"], reports["fresh"], stable_files)
        result = {"result": "PASS", "complete_second_image_parity": True,
                  "stable_layer_files": stable_files, "warm_detector_cache": stats,
                  "timings": commands, "shared_cache_restored_or_exported": False}
        (output / "RESULT.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    run(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
