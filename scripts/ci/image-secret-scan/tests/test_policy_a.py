"""Policy A changes blocking decisions; detection and error handling remain complete."""

import base64
import json
import os
import unittest
from unittest.mock import patch

from image_secrets.common import ScanError
from image_secrets.gate import assess
from tests import test_scanner as scanner_tests
from tests.fixtures import docker_archive, fake_key, tar_bytes
from tests.test_review_regressions import token


class PolicyATests(unittest.TestCase):
    setUp = scanner_tests.ScannerTests.setUp
    tearDown = scanner_tests.ScannerTests.tearDown
    scan = scanner_tests.ScannerTests.scan

    def image(self, entries):
        archive = self.root / "image.tar"
        docker_archive(archive, [tar_bytes(entries)])
        return archive

    def packet(self, report, classification="public-material"):
        return {
            "schema": "image-secret-classifications-v1",
            "archive_sha256": report["archive_sha256"],
            "scanner_version": "1.0.3",
            "gitleaks_rules_sha256": report["policy"]["gitleaks_rules_sha256"],
            "allowlist_sha256": report["policy"]["allowlist_sha256"],
            "review": {
                "reviewer": "solution-architect-01",
                "reference": "synthetic test review",
                "report_sha256": "1" * 64,
            },
            "entries": [
                {
                    "finding_id": row["finding_id"],
                    "classification": classification,
                    "reason": "Synthetic fixture classification for a test only.",
                }
                for row in report["findings"]
            ],
        }

    def write_packet(self, packet):
        path = self.root / "review.json"
        path.write_text(json.dumps(packet))
        return path

    def test_entropy_is_recorded_advisory_only_in_explicit_credential_mode(self):
        value = base64.b64encode(os.urandom(60))
        archive = self.image([("data.txt", b'opaque="' + value + b'"\n')])
        strict, _ = self.scan(archive, 1)
        scoped, output = self.scan(archive, 0, ["--blocking-rules=credential"])
        self.assertEqual(strict["findings"], scoped["findings"])
        self.assertEqual(scoped["counts"]["blocking"], 0)
        self.assertEqual(scoped["counts"]["advisory"], len(scoped["findings"]))
        self.assertEqual(scoped["advisory_findings"], scoped["findings"])
        self.assertNotIn(value.decode(), output)

    def test_provider_token_and_private_key_remain_blocking(self):
        value = token()
        archive = self.image([("data.txt", value.encode() + b"\n" + fake_key())])
        report, output = self.scan(archive, 1, ["--blocking-rules=credential"])
        rules = {row["rule"] for row in report["blocking_findings"]}
        self.assertIn("gitleaks.github-pat", rules)
        self.assertIn("content.private-key-header", rules)
        self.assertNotIn(value, output)

    def test_scanner_errors_still_fail_closed_in_credential_mode(self):
        archive = self.image([("renamed.dat", b"PK\x03\x04corrupt")])
        report, _ = self.scan(archive, 2, ["--blocking-rules=credential"])
        self.assertFalse(report["complete"])
        with patch("image_secrets.backend.Gitleaks.scan", side_effect=OSError("unsafe error text")):
            _, output = self.scan(archive, 2, ["--blocking-rules=credential"])
        self.assertNotIn("unsafe error text", output)

    def test_exact_reviewed_public_material_and_examples_are_nonblocking(self):
        archive = self.image([("public.pem", b"public placeholder\n")])
        report, _ = self.scan(archive, 1, ["--blocking-rules=credential"])
        for classification in ("public-material", "library-example", "test-fixture"):
            packet = self.write_packet(self.packet(report, classification))
            reviewed, _ = self.scan(
                archive, 0, ["--blocking-rules=credential", "--classifications", str(packet)]
            )
            self.assertEqual(reviewed["findings"], report["findings"])
            self.assertEqual(reviewed["counts"]["reviewed"], len(report["findings"]))
            self.assertEqual(reviewed["counts"]["blocking"], 0)

    def test_real_blocks_even_when_the_original_rule_is_generic_entropy(self):
        archive = self.image([("data.txt", b'opaque="' + base64.b64encode(os.urandom(60)) + b'"\n')])
        report, _ = self.scan(archive, 0, ["--blocking-rules=credential"])
        packet = self.write_packet(self.packet(report, "REAL"))
        reviewed, _ = self.scan(archive, 1, ["--blocking-rules=credential", "--classifications", str(packet)])
        self.assertEqual(reviewed["counts"]["advisory"], 0)
        self.assertTrue(all(row["classification"] == "REAL" for row in reviewed["blocking_findings"]))

    def test_classification_packet_cannot_transfer_to_another_artifact_or_policy(self):
        archive = self.image([("public.pem", b"public placeholder")])
        report, _ = self.scan(archive, 1, ["--blocking-rules=credential"])
        for field in ("archive_sha256", "scanner_version", "gitleaks_rules_sha256", "allowlist_sha256"):
            packet = self.packet(report)
            packet[field] = "0" * 64
            path = self.write_packet(packet)
            result, _ = self.scan(archive, 2, ["--blocking-rules=credential", "--classifications", str(path)])
            self.assertEqual(result["error"], "classification-artifact-or-policy-mismatch")

    def test_stale_duplicate_unknown_or_unreviewed_entries_fail_closed(self):
        archive = self.image([("public.pem", b"public placeholder")])
        report, _ = self.scan(archive, 1, ["--blocking-rules=credential"])
        variants = []
        packet = self.packet(report)
        packet["entries"][0]["finding_id"] = "0" * 64
        variants.append(packet)
        packet = self.packet(report)
        packet["entries"] += packet["entries"]
        variants.append(packet)
        packet = self.packet(report)
        packet["entries"][0]["classification"] = "ignore"
        variants.append(packet)
        packet = self.packet(report)
        packet["review"]["reviewer"] = "unreviewed"
        variants.append(packet)
        variants.append({})
        for packet in variants:
            path = self.write_packet(packet)
            self.scan(archive, 2, ["--blocking-rules=credential", "--classifications", str(path)])

    def test_unclassified_paths_and_unknown_provider_rules_block(self):
        result = {
            "findings": [
                {"rule": rule, "finding_id": str(index)}
                for index, rule in enumerate(
                    ["path.key-or-certificate", "path.aws-credentials", "gitleaks.future-provider-token"]
                )
            ],
            "allowlisted": [],
        }
        assess(result, "credential")
        self.assertEqual(result["counts"]["blocking"], 3)
        with self.assertRaises(ScanError):
            assess(result, "invalid")

    def test_default_mode_does_not_accept_classification_exceptions(self):
        archive = self.image([("public.pem", b"public placeholder")])
        self.scan(archive, 2, ["--classifications", str(self.root / "unused.json")])
        with self.assertRaises(ScanError):
            assess({}, "all", self.root / "unused.json")

    def test_review_text_is_not_disclosed_and_oversized_packet_fails(self):
        archive = self.image([("public.pem", b"public placeholder")])
        report, _ = self.scan(archive, 1, ["--blocking-rules=credential"])
        private_value = token()
        packet = self.packet(report)
        packet["review"]["reference"] = private_value
        packet["entries"][0]["reason"] = private_value
        path = self.write_packet(packet)
        _, output = self.scan(archive, 0, ["--blocking-rules=credential", "--classifications", str(path)])
        self.assertNotIn(private_value, output)
        path.write_bytes(b" " * (16 * 1024 * 1024 + 1))
        failed, _ = self.scan(archive, 2, ["--blocking-rules=credential", "--classifications", str(path)])
        self.assertEqual(failed["error"], "classification-packet-too-large")

    def test_candidate_hash_distinguishes_two_values_on_one_line(self):
        value = token()
        other = token()
        archive = self.image([("tokens.txt", (value + " " + other).encode())])
        report, _ = self.scan(archive, 1, ["--blocking-rules=credential"])
        rows = [row for row in report["findings"] if row["rule"] == "gitleaks.github-pat"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({row["finding_id"] for row in rows}), 2)
        self.assertEqual(len({row["candidate_sha256"] for row in rows}), 2)
