"""Reject substituted reviews, assessments and generated classification packets."""

import copy
import json
from pathlib import Path
import tempfile
import unittest

import test_staging_image as fixtures
from staging_content_receipt import verify_content_receipt
from staging_scan_receipt import checksum


class ContentReceiptTests(unittest.TestCase):
    setUp = fixtures.StagingImageTests.setUp
    write_archive = fixtures.StagingImageTests.write_archive
    write_content_receipt = fixtures.StagingImageTests.write_content_receipt

    def scan(self, directory):
        return json.loads((directory / "secret-scan/REPORT.json").read_text())

    def verify(self, directory):
        return verify_content_receipt(directory, self.metadata, self.scan(directory))

    def test_approved_complete_resolution_and_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.write_archive(directory, self.metadata)
            policy, receipt = self.verify(directory)
            self.assertEqual(policy["classifications_sha256"],
                             checksum(directory / "secret-scan/classifications.json"))
            self.assertEqual(receipt["reviewSha256"], checksum(self.review))
            self.assertEqual(receipt["catalogSha256"], checksum(self.catalog))

    def test_confirmation_and_resolution_identity_fail_closed(self):
        cases = [
            ("review", "verdict", "PENDING"), ("review", "reviewer", "unreviewed"),
            ("review", "catalog_sha256", "0" * 64), ("review", "adapter_files", {}),
            ("resolution", "schema", "unknown"), ("resolution", "complete", False),
            ("resolution", "proposal", True), ("resolution", "status", "REVIEW_REQUIRED"),
            ("resolution", "unresolved", [{}]), ("resolution", "matched", False),
            ("resolution", "matched", 1), ("resolution", "identities", []),
            ("resolution", "identities", {"a" * 64: "invalid"}),
        ]
        cases += [("resolution", key, "0" * 64) for key in (
            "archive_sha256", "raw_report_sha256", "catalog_sha256", "packet_sha256",
            "review_sha256", "report_sha256", "adapter_files")]
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for target, key, value in cases:
                self.write_archive(directory, self.metadata)
                path = self.review if target == "review" else directory / "secret-scan/RESOLUTION.json"
                data = json.loads(path.read_text())
                data[key] = value
                path.write_text(json.dumps(data))
                if target == "review":
                    self.review.with_suffix(".sha256").write_text(checksum(self.review))
                with self.subTest(target=target, key=key), self.assertRaises(ValueError):
                    self.verify(directory)

    def test_confirmation_must_match_committed_checksum(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.write_archive(directory, self.metadata)
            for value in ("invalid", "0" * 64):
                self.review.with_suffix(".sha256").write_text(value)
                with self.subTest(value=value), self.assertRaisesRegex(ValueError, "checksum"):
                    self.verify(directory)

    def test_raw_errors_or_changed_evidence_cannot_be_assessed_clean(self):
        cases = [("complete", False), ("error", "incomplete"), ("exit_code", 2),
                 ("exit_code", False), ("status", "ERROR"),
                 ("reviewed_classifications", [{}]), ("findings", [{}]), ("policy", {})]
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for key, value in cases:
                self.write_archive(directory, self.metadata)
                raw_path = directory / "secret-scan-raw/REPORT.json"
                data = json.loads(raw_path.read_text())
                data[key] = value
                raw_path.write_text(json.dumps(data))
                resolution_path = directory / "secret-scan/RESOLUTION.json"
                resolution = json.loads(resolution_path.read_text())
                resolution["raw_report_sha256"] = checksum(raw_path)
                resolution_path.write_text(json.dumps(resolution))
                with self.subTest(key=key), self.assertRaises(ValueError):
                    self.verify(directory)

    def test_packet_cannot_add_unapproved_classification(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.write_archive(directory, self.metadata)
            packet_path = directory / "secret-scan/classifications.json"
            packet = json.loads(packet_path.read_text())
            packet["entries"] = [{"finding_id": "a" * 64, "classification": "public-material",
                                  "reason": "Unapproved test-only substitution"}]
            packet_path.write_text(json.dumps(packet))
            path = directory / "secret-scan/RESOLUTION.json"
            resolution = json.loads(path.read_text())
            resolution["packet_sha256"] = checksum(packet_path)
            path.write_text(json.dumps(resolution))
            with self.assertRaisesRegex(ValueError, "packet differs"):
                self.verify(directory)

    def test_unknown_finding_and_inconsistent_catalog_fail_replay(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.write_archive(directory, self.metadata)
            scan = self.scan(directory)
            scan["findings"] = [{"finding_id": "a" * 64, "path": "path-sha256:" + "b" * 64,
                                 "rule": "gitleaks.github-pat"}]
            raw = copy.deepcopy(scan)
            raw["policy"] = {k: v for k, v in raw["policy"].items() if not k.startswith("classification")}
            raw.update(status="FINDINGS", exit_code=1)
            raw_path = directory / "secret-scan-raw/REPORT.json"
            scan_path = directory / "secret-scan/REPORT.json"
            raw_path.write_text(json.dumps(raw))
            scan_path.write_text(json.dumps(scan))
            path = directory / "secret-scan/RESOLUTION.json"
            resolution = json.loads(path.read_text())
            resolution.update(raw_report_sha256=checksum(raw_path), report_sha256=checksum(scan_path))
            path.write_text(json.dumps(resolution))
            with self.assertRaisesRegex(ValueError, "Unreviewed"):
                self.verify(directory)
            # A catalog parser failure is also a fixed, fail-closed validation error.
            from unittest.mock import patch
            from image_secrets.common import ScanError
            with patch("content_catalog.read_catalog", side_effect=ScanError("invalid-catalog")):
                with self.assertRaisesRegex(ValueError, "replay failed"):
                    self.verify(directory)
