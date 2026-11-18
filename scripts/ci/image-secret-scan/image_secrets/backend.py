"""Gitleaks adapter. Raw reports are private, transient, and never published."""

import os
import re
import subprocess
import time

from .common import ScanError, digest_bytes, digest_file, json_bytes


class Gitleaks:
    def __init__(self, executable, rules, workspace, timeout):
        self.executable, self.rules = executable, rules
        self.workspace, self.timeout = workspace, timeout
        self.ignore = workspace / "empty.gitleaksignore"
        self.ignore.write_text("")
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GITLEAKS_")}
        result = subprocess.run(
            [executable, "version"], check=False, capture_output=True, env=self.env, timeout=timeout
        )
        version = result.stdout.decode("ascii", "replace").strip()
        if result.returncode or not re.fullmatch(r"8\.(?:2[5-9]|[3-9][0-9])\.[0-9]+", version):
            raise ScanError("gitleaks-8-25-or-newer-required")
        self.cache = None
        self.version = version
        self.metrics = {"detect_seconds": 0.0, "map_seconds": 0.0, "digest_files": 0, "digest_bytes": 0}

    def scan(self, stage, locations, findings):
        if self.cache is None or stage.name != "layer":
            return self.detect(stage, locations, findings)
        digests = {p: digest_file(p) for p in locations}
        hits, pending = {}, {}
        for physical, location in locations.items():
            rows = self.cache.lookup(physical, digests[physical])
            if rows is None:
                pending[physical] = location
            else:
                hits[physical] = rows
        held = self.workspace / "cached-detector-inputs"
        held.mkdir()
        collected = {p: [] for p in pending}
        try:
            for physical in hits:
                physical.rename(held / physical.name)
            if pending:
                self.detect(stage, pending, findings, collected)
        finally:
            for physical in hits:
                saved = held / physical.name
                if saved.exists():
                    saved.rename(physical)
            held.rmdir()
        # Reapply the current allowlist at every physical occurrence. Cache rows
        # carry no policy disposition and no image path or raw detector secret.
        for physical, rows in hits.items():
            for row in rows:
                findings.add(row["rule"], locations[physical], row["candidate_sha256"], row["line"],
                             file_digest=digests[physical])
        # A None row set means Gitleaks reported an unexpected nested suffix;
        # always rescan that input instead of persisting incomplete evidence.
        for physical, rows in collected.items():
            if rows is not None:
                self.cache.store(physical, digests[physical], rows)

    def detect(self, stage, locations, findings, observed=None):
        raw = self.workspace / "gitleaks-private.json"
        error_log = self.workspace / "gitleaks-private.stderr"
        raw.unlink(missing_ok=True)
        argv = [
            self.executable,
            "dir",
            str(stage),
            "--config",
            str(self.rules),
            "--gitleaks-ignore-path",
            str(self.ignore),
            "--ignore-gitleaks-allow",
            "--no-banner",
            "--no-color",
            "--log-level",
            "warn",
            "--redact=0",
            "--max-target-megabytes",
            "0",
            "--max-archive-depth",
            "0",
            "--max-decode-depth",
            "5",
            "--timeout",
            str(self.timeout),
            "--report-format",
            "json",
            "--report-path",
            str(raw),
        ]
        # Values are needed privately for exact-value exceptions; stdout/stderr never reach a terminal.
        started = time.monotonic()
        with error_log.open("wb") as errors:
            result = subprocess.run(
                argv,
                check=False,
                cwd=self.workspace,
                env=self.env,
                stdout=subprocess.DEVNULL,
                stderr=errors,
                timeout=self.timeout + 5,
            )
        self.metrics["detect_seconds"] += time.monotonic() - started
        # A depth-limit, unreadable archive, or other skipped input invalidates CLEAN.
        # The only expected warning is Gitleaks' final finding count; never publish log text.
        messages = error_log.read_text(errors="replace").splitlines()
        unexpected_warning = any(
            not re.fullmatch(r".*\bWRN leaks found: \d+\s*", line) for line in messages if line.strip()
        )
        if result.returncode not in (0, 1) or not raw.is_file() or unexpected_warning:
            raise ScanError("gitleaks-incomplete")
        if raw.stat().st_size > 64 * 1024 * 1024:
            raise ScanError("gitleaks-report-too-large")
        rows = json_bytes(raw.read_bytes())
        if not isinstance(rows, list) or (bool(rows) != (result.returncode == 1)):
            raise ScanError("gitleaks-result-inconsistent")
        started = time.monotonic()
        index = self.index(stage, locations)
        digests = {}
        for row in rows:
            if not isinstance(row, dict):
                raise ScanError("invalid-gitleaks-finding")
            name, rule, secret = row.get("File"), row.get("RuleID"), row.get("Secret")
            if (
                not isinstance(name, str)
                or not isinstance(rule, str)
                or not isinstance(secret, str)
                or not re.fullmatch(r"[a-zA-Z0-9_.-]+", rule)
            ):
                raise ScanError("invalid-gitleaks-finding")
            location, physical = self.resolve_index(name, index)
            line = row.get("StartLine")
            if not isinstance(line, int) or line < 0:
                raise ScanError("invalid-gitleaks-line")
            if physical not in digests:
                digests[physical] = digest_file(physical)
                self.metrics["digest_files"] += 1
                self.metrics["digest_bytes"] += physical.stat().st_size
            if observed is not None:
                if location != locations[physical]:
                    observed[physical] = None
                elif observed[physical] is not None:
                    observed[physical].append({"rule": "gitleaks." + rule,
                        "candidate_sha256": digest_bytes(secret.encode()), "line": line})
            findings.add(
                "gitleaks." + rule,
                location,
                digest_bytes(secret.encode()),
                line,
                file_digest=digests[physical],
            )
        self.metrics["map_seconds"] += time.monotonic() - started
        raw.unlink()
        error_log.unlink()

    @staticmethod
    def locate(name, stage, locations):
        return Gitleaks.resolve(name, stage, locations)[0]

    @staticmethod
    def index(stage, locations):
        result = {}
        for physical, location in locations.items():
            for name in (str(physical), physical.name, str(physical.relative_to(stage))):
                if name in result and result[name][1] != physical:
                    raise ScanError("ambiguous-gitleaks-path")
                result[name] = (location, physical)
        return result

    @staticmethod
    def resolve_index(name, index):
        if name in index:
            return index[name]
        # Synthetic paths contain no '!'; preserve nested origin mapping.
        prefix, separator, suffix = name.partition("!")
        if separator and prefix in index:
            location, physical = index[prefix]
            return dict(location, path=location["path"] + "!" + suffix), physical
        raise ScanError("unmapped-gitleaks-path")

    @staticmethod
    def resolve(name, stage, locations):
        return Gitleaks.resolve_index(name, Gitleaks.index(stage, locations))
