import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import audit_dependencies as audit


class AuditExceptionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.now = datetime(2026, 11, 18, tzinfo=timezone.utc)
        self.config = {"schema": "ornn-audit-exceptions-v1", "exceptions": [{
            "advisory": "GHSA-fc5q-39xc-vjpf", "package": "picomatch", "version": "4.0.5",
            "expires_at": (self.now + timedelta(days=1)).isoformat(),
            "tracking_issue": "https://github.com/ChronoAIProject/Ornn/issues/1257",
            "justification": "Build-only dependency absent from runtime.",
            "input_sha256": {},
        }]}
        for name in audit.REQUIRED_INPUTS:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"reviewed input")
            self.config["exceptions"][0]["input_sha256"][name] = hashlib.sha256(path.read_bytes()).hexdigest()

    def test_exact_exception_keeps_other_advisories_blocking(self):
        ids = audit.exception_ids(self.config, self.root, self.now)
        self.assertEqual(ids, ["GHSA-fc5q-39xc-vjpf"])
        self.assertEqual(audit.audit_command(ids), ["bun", "audit", "--audit-level=high", *[
            f"--ignore={value}" for value in (*audit.EXISTING_IGNORES, *ids)
        ]])

    def test_rejects_at_expiry_and_after(self):
        for offset in (1, 2):
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                audit.exception_ids(self.config, self.root, self.now + timedelta(days=offset))

    def test_rejects_changed_input_and_symlink(self):
        path = self.root / "bun.lock"
        path.write_bytes(b"unreviewed dependencies")
        with self.assertRaises(ValueError):
            audit.exception_ids(self.config, self.root, self.now)
        path.unlink()
        path.symlink_to(self.root / "package.json")
        with self.assertRaises(ValueError):
            audit.exception_ids(self.config, self.root, self.now)

    def test_rejects_malformed_or_broad_exceptions(self):
        mutations = [
            ("advisory", "*"), ("advisory", "--ignore=*"), ("advisory", None),
            ("expires_at", "2026-11-19"), ("expires_at", "never"),
            ("justification", ""), ("tracking_issue", None), ("input_sha256", {}),
        ]
        for field, value in mutations:
            config = copy.deepcopy(self.config)
            config["exceptions"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises((ValueError, TypeError)):
                audit.exception_ids(config, self.root, self.now)
        for name in ("../outside", "/outside", "..\\outside"):
            config = copy.deepcopy(self.config)
            config["exceptions"][0]["input_sha256"][name] = "a" * 64
            with self.subTest(name=name), self.assertRaises(ValueError):
                audit.exception_ids(config, self.root, self.now)
        self.config["exceptions"].append(copy.deepcopy(self.config["exceptions"][0]))
        with self.assertRaises(ValueError):
            audit.exception_ids(self.config, self.root, self.now)

    def test_main_propagates_audit_errors_and_rejects_bad_config(self):
        config_dir = self.root / ".github"
        config_dir.mkdir()
        config = config_dir / "audit-exceptions.json"
        config.write_text(json.dumps(self.config))
        with patch.object(audit, "ROOT", self.root), patch.object(audit, "datetime") as clock:
            clock.now.return_value = self.now
            clock.fromisoformat.side_effect = datetime.fromisoformat
            with patch.object(audit.subprocess, "run") as run:
                run.return_value.returncode = 1
                self.assertEqual(audit.main(), 1)
                run.side_effect = OSError("audit unavailable")
                self.assertEqual(audit.main(), 2)
            config.write_text("invalid")
            with patch.object(audit.subprocess, "run") as run:
                self.assertEqual(audit.main(), 2)
                run.assert_not_called()

    def test_rejects_wrong_schema_and_digest(self):
        for key, value in (("schema", "unknown"), ("exceptions", {})):
            config = copy.deepcopy(self.config)
            config[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                audit.exception_ids(config, self.root, self.now)
        for digest in (None, "not-a-digest"):
            config = copy.deepcopy(self.config)
            config["exceptions"][0]["input_sha256"]["bun.lock"] = digest
            with self.subTest(digest=digest), self.assertRaises(ValueError):
                audit.exception_ids(config, self.root, self.now)


if __name__ == "__main__":
    unittest.main()
