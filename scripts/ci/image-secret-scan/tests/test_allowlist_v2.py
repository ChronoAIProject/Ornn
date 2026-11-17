"""Reviewed generic calibrations must not suppress credential-specific findings."""

import base64
import json
import os
import unittest

from image_secrets.allowlist import Allowlist
from image_secrets.common import ScanError
from tests import test_scanner as scanner_tests
from tests.fixtures import digest, docker_archive, fake_key, tar_bytes
from tests.test_review_regressions import token


class ReviewedAllowlistTests(unittest.TestCase):
    setUp = scanner_tests.ScannerTests.setUp
    tearDown = scanner_tests.ScannerTests.tearDown
    scan = scanner_tests.ScannerTests.scan

    def entry(self, body):
        return {
            "id": "reviewed-static-file",
            "rule": "gitleaks.image-high-entropy",
            "scope": "layer",
            "path_glob": "usr/share/nginx/html/assets/*.js",
            "file_sha256": digest(body),
            "reason": "Runtime-generated public fixture constant; entire file reviewed.",
            "review": "synthetic-test-review",
        }

    def policy(self, entry):
        path = self.root / "allowlist.json"
        path.write_text(json.dumps({"version": 2, "entries": [entry]}))
        return path

    def test_glob_requires_exact_file_and_path_and_reports_exception(self):
        body = b'const data="' + base64.b64encode(os.urandom(60)) + b'";\n'
        policy = self.policy(self.entry(body))
        archive = self.root / "image.tar"
        filename = "usr/share/nginx/html/assets/app-abc123.js"
        docker_archive(archive, [tar_bytes([(filename, body)])])
        clean, output = self.scan(archive, 0, ["--allowlist", str(policy)])
        self.assertEqual(len(clean["allowlisted"]), 1)
        self.assertEqual(clean["allowlisted"][0]["allowlist_id"], "reviewed-static-file")
        self.assertNotIn(filename, output)
        for name, data in [
            (filename, body + b"changed"),
            ("outside/app.js", body),
            ("usr/share/nginx/html/assets/child/app.js", body),
        ]:
            docker_archive(archive, [tar_bytes([(name, data)])])
            report, _ = self.scan(archive, 1, ["--allowlist", str(policy)])
            self.assertEqual(report["allowlisted"], [])

    def test_real_token_and_private_key_stay_strict_even_in_pinned_file(self):
        private_value = token()
        body = b'const publicData="' + private_value.encode() + b'";\n' + fake_key()
        policy = self.policy(self.entry(body))
        archive = self.root / "image.tar"
        docker_archive(archive, [tar_bytes([("usr/share/nginx/html/assets/app.js", body)])])
        report, output = self.scan(archive, 1, ["--allowlist", str(policy)])
        rules = {f["rule"] for f in report["findings"]}
        self.assertIn("gitleaks.github-pat", rules)
        self.assertIn("content.private-key-header", rules)
        self.assertNotIn(private_value, output)

    def test_rejects_blanket_unreviewed_unpinned_or_provider_exceptions(self):
        good = self.entry(b"public data")
        bad = [
            dict(good, path_glob=p)
            for p in [
                "*",
                "*.map",
                "**/*.js",
                "usr/*/*.js",
                "/usr/share/*.js",
                "usr/share/../*.js",
                "usr/share/*.js!nested",
                "usr/share/[ab].js",
            ]
        ]
        bad += [
            dict(good, scope="config"),
            dict(good, review=""),
            dict(good, reason=""),
            dict(good, file_sha256="invalid"),
            {k: v for k, v in good.items() if k != "file_sha256"},
        ]
        strict_rules = [
            "gitleaks.github-pat",
            "gitleaks.aws-access-token",
            "gitleaks.gcp-api-key",
            "gitleaks.azure-storage-account-key",
            "gitleaks.private-key",
            "content.private-key-header",
            "content.service-account",
            "content.credential-url",
            "config.secret-assignment",
            "gitleaks.image-secret-assignment",
            "gitleaks.image-hex-secret-assignment",
            "path.aws-credentials",
        ]
        for rule in strict_rules:
            bad.append(dict(good, rule=rule))
            exact = {k: v for k, v in good.items() if k not in ("path_glob", "review")}
            bad.append(dict(exact, rule=rule, path="usr/share/app.js"))
        for entry in bad:
            with self.subTest(rule=entry["rule"]), self.assertRaises(ScanError):
                Allowlist(self.policy(entry))

    def test_scope_and_nested_members_do_not_inherit_glob(self):
        body = b"public data"
        policy = Allowlist(self.policy(self.entry(body)))
        for scope, name in [
            ("layer", "usr/share/nginx/html/assets/app.js!inner"),
            ("layer", "container!usr/share/nginx/html/assets/app.js"),
            ("layer", "app.js"),
            ("config", "usr/share/nginx/html/assets/app.js"),
        ]:
            self.assertIsNone(
                policy.match(
                    "gitleaks.image-high-entropy", {"scope": scope, "path": name}, digest(body), digest(body)
                )
            )

    def test_exact_public_checksum_remains_supported(self):
        good = self.entry(b"public checksum")
        exact = {k: v for k, v in good.items() if k not in ("path_glob", "review")}
        exact.update(rule="gitleaks.generic-api-key", scope="config", path="config/history/8/created_by")
        policy = Allowlist(self.policy(exact))
        location = {"scope": "config", "path": "config/history/8/created_by"}
        self.assertIsNotNone(policy.match(exact["rule"], location, None, digest(b"public checksum")))
        self.assertIsNone(policy.match(exact["rule"], location, None, digest(b"different bytes")))
