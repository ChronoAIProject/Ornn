"""Sanitized detector-only reuse. Caller must authenticate the cache producer.

No final approval, path, raw secret, or image bytes are cached. Archive/layer
validation, metadata/nested traversal and all policy decisions always run fresh.
"""
import hashlib
import json
import platform
import re
import shutil
import sys
from pathlib import Path

from .common import ScanError, digest_file, json_bytes

MAX_BYTES = 64 * 1024 * 1024
MAX_ENTRIES = 100000
HEX = re.compile(r"[a-f0-9]{64}")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def fingerprint(scanner, backend, limits):
    paths = sorted(scanner.glob("image_secrets/*.py")) + [scanner / "scan_image_secrets.py", scanner / "gitleaks.toml"]
    binary = shutil.which(backend.executable)
    if binary is None:
        raise ScanError("cache-detector-binary-missing")
    return hashlib.sha256(canonical({
        "schema": "image-detector-cache-v1", "scanner": {str(p.relative_to(scanner)): digest_file(p) for p in paths},
        "gitleaks_binary": digest_file(Path(binary)), "gitleaks_version": backend.version,
        "python": list(sys.version_info[:3]), "platform": platform.platform(), "limits": limits,
        "detector_flags": ["ignore-gitleaks-allow", "max-target-megabytes=0", "max-archive-depth=0", "max-decode-depth=5"],
    })).hexdigest()


def valid_rows(rows):
    return (isinstance(rows, list) and len(rows) <= 100000 and all(
        isinstance(row, dict) and set(row) == {"rule", "candidate_sha256", "line"}
        and isinstance(row["rule"], str) and re.fullmatch(r"gitleaks\.[a-zA-Z0-9_.-]+", row["rule"])
        and isinstance(row["candidate_sha256"], str) and HEX.fullmatch(row["candidate_sha256"])
        and type(row["line"]) is int and row["line"] >= 0 for row in rows))


class DetectorCache:
    def __init__(self, identity, source=None):
        self.identity, self.entries = identity, {}
        self.stats = {"hits": 0, "misses": 0, "hit_bytes": 0, "miss_bytes": 0, "invalid": 0}
        if source is not None and source.exists():
            try:
                if source.is_symlink() or source.stat().st_size > MAX_BYTES:
                    raise ValueError()
                doc = json_bytes(source.read_bytes())
                if (set(doc) != {"schema", "identity", "entries"} or doc["schema"] != "image-detector-cache-v1"
                        or doc["identity"] != identity or not isinstance(doc["entries"], dict)
                        or len(doc["entries"]) > MAX_ENTRIES):
                    raise ValueError()
                for key, value in doc["entries"].items():
                    if not isinstance(key, str) or not HEX.fullmatch(key) or not valid_rows(value):
                        raise ValueError()
                self.entries = doc["entries"]
            except (ValueError, TypeError, OSError, ScanError, KeyError):
                # Corruption/stale identity cannot turn a miss into a scan bypass.
                self.stats["invalid"] += 1

    @staticmethod
    def key(physical, digest):
        # Bind the detector's synthetic basename as well as the blob. It is never
        # image-controlled, but a future path-sensitive rule must not alias it.
        return hashlib.sha256(canonical({"sha256": digest, "name": physical.name, "stage": "layer"})).hexdigest()

    def lookup(self, physical, digest):
        key = self.key(physical, digest)
        rows = self.entries.get(key)
        kind = "miss" if rows is None else "hit"
        self.stats["misses" if rows is None else "hits"] += 1
        self.stats[kind + "_bytes"] += physical.stat().st_size
        return rows

    def store(self, physical, digest, rows):
        if valid_rows(rows) and (len(self.entries) < MAX_ENTRIES or self.key(physical, digest) in self.entries):
            self.entries[self.key(physical, digest)] = rows

    def save(self, destination):
        raw = canonical({"schema": "image-detector-cache-v1", "identity": self.identity, "entries": self.entries})
        if len(raw) > MAX_BYTES:
            raise ScanError("cache-output-budget-exceeded")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".pending")
        with temporary.open("xb") as stream:
            stream.write(raw)
        temporary.replace(destination)
