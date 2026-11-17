import contextlib
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import scan_image_secrets as cli
from image_secrets.archive import ImageArchive
from image_secrets.backend import Gitleaks
from image_secrets.common import Budget, ScanError, archive_path, copy_stream, json_bytes
from image_secrets.engine import decoded_strings
from image_secrets.policy import Allowlist, Findings, path_rule
from tests.fixtures import digest, tar_bytes


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="scanner-boundaries-")
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_json_paths_copy_and_budget_validation(self):
        for value in [b'{"a":1,"a":2}', b"{", b"\xff", b'{"a":NaN}']:
            with self.assertRaises(ScanError):
                json_bytes(value)
        for value in [None, "a\\b", "a\x00b", "/absolute", "a/../escape"]:
            with self.assertRaises(ScanError):
                archive_path(value)
        with self.assertRaises(ScanError):
            copy_stream(io.BytesIO(b"too long"), self.root / "copy", 2)
        with self.assertRaises(ScanError):
            Budget(1, 1).reserve(2)
        with self.assertRaises(ScanError):
            list(decoded_strings("x", depth=65))
        self.assertIn(
            ("/@joined", "--password lowentropy"), list(decoded_strings(["--password", "lowentropy"]))
        )

    def test_all_target_path_families(self):
        for path in [
            ".kube/config",
            ".config/gcloud/credentials.db",
            ".cargo/credentials.toml",
            ".aws/sso/cache/a.json",
            ".azure/msal_token_cache.bin",
            "id_rsa.pub",
        ]:
            self.assertIsNotNone(path_rule(path), path)
        self.assertIsNone(path_rule("src/main.py"))

    def test_allowlist_rejects_broad_or_key_exceptions(self):
        good = {
            "id": "public",
            "rule": "gitleaks.image-high-entropy",
            "scope": "layer",
            "path": "public.txt",
            "match_sha256": "0" * 64,
            "reason": "Verified public value",
        }
        values = [
            {},
            {"version": 1, "entries": [dict(good, reason="")]},
            {"version": 1, "entries": [dict(good, path="*")]},
            {"version": 1, "entries": [dict(good, rule="content.private-key-header")]},
            {"version": 1, "entries": [good, good]},
            {"version": 1, "entries": [{"id": "incomplete"}]},
        ]
        for value in values:
            path = self.root / "allow.json"
            path.write_text(json.dumps(value))
            with self.assertRaises(ScanError):
                Allowlist(path)

    def test_path_redaction_and_control_escaping(self):
        findings = Findings(Allowlist(cli.HERE / "allowlist.json"))
        location = {"scope": "layer", "image": 0, "layer": 0, "entry": 0, "path": "dir/opaque-value\x1b[31m"}
        findings.add("test-rule", location)
        findings.add("test-rule", location)
        self.assertEqual(len(findings.items), 1)
        safe = findings.safe_items(findings.items)
        self.assertNotIn("opaque-value", safe[0]["path"])
        text = cli.report_text({"status": "FINDINGS", "findings": safe * 101, "allowlisted": []})
        self.assertNotIn("\x1b", text)
        self.assertIn("Additional finding", text)

    def test_image_export_failures_are_sanitized(self):
        for ref in ["-option", "user:pass@host@sha256:abc", "ref;echo"]:
            with self.assertRaises(ScanError):
                cli.image_export(ref, self.root / "out.tar", 10)
        with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 1, b"private error")):
            with self.assertRaisesRegex(ScanError, "inspect"):
                cli.image_export("valid:tag", self.root / "out.tar", 10)
        responses = [
            subprocess.CompletedProcess([], 0, b"sha256:" + b"0" * 64),
            subprocess.CompletedProcess([], 1),
        ]
        with patch("subprocess.run", side_effect=responses):
            with self.assertRaisesRegex(ScanError, "export"):
                cli.image_export("valid:tag", self.root / "out.tar", 10)

    def test_descriptor_size_digest_and_manifest_validation(self):
        raw = b"not secret"
        path = self.root / "blobs.tar"
        path.write_bytes(
            tar_bytes([("blobs/sha256/" + digest(raw), raw), ("link", (tarfile.SYMTYPE, "/outside"))])
        )
        with ImageArchive(path, self.root, Budget(1000000, 100)) as archive:
            desc = {"digest": "sha256:" + digest(raw), "size": len(raw)}
            self.assertTrue(archive.descriptor(desc).startswith("blobs/"))
            for bad in [
                None,
                {},
                dict(desc, size=-1),
                dict(desc, size=100),
                dict(desc, digest="sha256:" + "0" * 64),
            ]:
                with self.assertRaises(ScanError):
                    archive.descriptor(bad)
            with self.assertRaises(ScanError):
                archive.stream("link")
            with self.assertRaises(ScanError):
                archive.read("blobs/sha256/" + digest(raw), limit=2)
            with self.assertRaises(ScanError):
                archive.images()
            for index in [{}, {"schemaVersion": 2, "manifests": []}]:
                with self.assertRaises(ScanError):
                    archive.walk_index(index, set(), 0)
        for config in [
            b"{}",
            b'{"rootfs":{"type":"other","diff_ids":[]}}',
            b'{"rootfs":{"type":"layers","diff_ids":["wrong"]}}',
        ]:
            with self.assertRaises(ScanError):
                ImageArchive.image(config, ["layer"])

    def test_backend_rejects_partial_and_malformed_results(self):
        backend = Gitleaks("gitleaks", cli.HERE / "gitleaks.toml", self.root, 5)
        stage = self.root / "stage"
        stage.mkdir()
        physical = stage / "entry.txt"
        physical.write_text("clean")
        location = {"scope": "layer", "image": 0, "layer": 0, "entry": 0, "path": "archive.zip"}
        mappings = {physical: location}
        self.assertEqual(
            backend.locate(str(physical) + "!inner.txt", stage, mappings)["path"], "archive.zip!inner.txt"
        )
        with self.assertRaises(ScanError):
            backend.locate("unknown", stage, mappings)
        for payload, code in [
            (None, 2),
            ({}, 0),
            ([], 1),
            ([{}], 1),
            ([{"File": str(physical), "RuleID": "rule", "Secret": "abc", "StartLine": -1}], 1),
        ]:

            def fake_run(*unused, payload=payload, code=code, **kwargs):
                if payload is not None:
                    (self.root / "gitleaks-private.json").write_text(json.dumps(payload))
                return subprocess.CompletedProcess([], code)

            with patch("subprocess.run", side_effect=fake_run), self.assertRaises(ScanError):
                backend.scan(stage, mappings, Findings(Allowlist(cli.HERE / "allowlist.json")))
        with patch("subprocess.run", return_value=subprocess.CompletedProcess([], 0, b"8.1.0")):
            with self.assertRaises(ScanError):
                Gitleaks("gitleaks", cli.HERE / "gitleaks.toml", self.root, 5)

    def test_output_error_interrupt_and_low_disk_fail_closed(self):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cli.main(["missing", "--output", str(self.root)]), 2)
        with self.assertRaises(KeyboardInterrupt):
            cli.interrupted(15, None)
        output = io.StringIO()
        with contextlib.redirect_stderr(output), self.assertRaises(SystemExit) as error:
            cli.arguments(["archive", "--input-kind", "private-invalid-value", "--output", "unused"])
        self.assertEqual(error.exception.code, 2)
        self.assertNotIn("private-invalid-value", output.getvalue())


if __name__ == "__main__":
    unittest.main()
