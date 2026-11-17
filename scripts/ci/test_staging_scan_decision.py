import copy
import unittest

from staging_scan_decision import verify_decision


class DecisionTests(unittest.TestCase):
    def setUp(self):
        self.entry = {
            "finding_id": "a" * 64,
            "rule": "gitleaks.image-high-entropy",
            "path": "path-sha256:" + "b" * 64,
        }
        self.scan = {
            "scanner_version": "1.0.3",
            "blocking_rules": "credential",
            "status": "CLEAN",
            "complete": True,
            "exit_code": 0,
            "findings": [self.entry],
            "advisory_findings": [self.entry],
            "reviewed_classifications": [],
            "blocking_findings": [],
            "allowlisted": [],
            "policy": {},
            "counts": {
                "detected": 1,
                "blocking": 0,
                "advisory": 1,
                "reviewed": 0,
                "allowlisted": 0,
            },
        }

    def test_advisory_entropy_remains_recorded(self):
        self.assertEqual(verify_decision(self.scan)["counts"]["advisory"], 1)

    def test_reviewed_finding_requires_exact_approved_hashes(self):
        scan = copy.deepcopy(self.scan)
        scan["advisory_findings"] = []
        scan["reviewed_classifications"] = [
            dict(self.entry, classification="public-material")
        ]
        scan["counts"].update(advisory=0, reviewed=1)
        scan["policy"].update(
            classifications_sha256="c" * 64, classification_review_sha256="d" * 64
        )
        self.assertEqual(
            verify_decision(scan, "c" * 64, "d" * 64)["counts"]["reviewed"], 1
        )
        for args in ((), ("e" * 64, "d" * 64), ("c" * 64, "e" * 64), ("bad", "bad")):
            with self.subTest(args=args), self.assertRaises(ValueError):
                verify_decision(scan, *args)
        scan["reviewed_classifications"][0]["classification"] = "REAL"
        with self.assertRaises(ValueError):
            verify_decision(scan, "c" * 64, "d" * 64)

    def test_rejects_incomplete_unclassified_substituted_or_credential_advisory(self):
        mutations = [
            ("complete", False),
            ("exit_code", False),
            ("exit_code", 2),
            ("status", "ERROR"),
            ("error", "decoder-error"),
            ("blocking_rules", "all"),
            ("scanner_version", "1.0.2"),
            ("advisory_findings", []),
            ("advisory_findings", [self.entry, self.entry]),
            ("blocking_findings", [self.entry]),
            ("findings", None),
            ("allowlisted", None),
            ("counts", {}),
        ]
        for field, value in mutations:
            scan = copy.deepcopy(self.scan)
            scan[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                verify_decision(scan)
        for rule in (
            "gitleaks.github-pat",
            "gitleaks.jwt",
            "content.private-key-header",
            "content.credential-url",
            "gitleaks.generic-api-key",
            "path.key-or-certificate",
        ):
            scan = copy.deepcopy(self.scan)
            scan["findings"][0]["rule"] = rule
            with self.subTest(rule=rule), self.assertRaises(ValueError):
                verify_decision(scan)
        scan = copy.deepcopy(self.scan)
        scan["counts"]["blocking"] = False
        with self.assertRaises(ValueError):
            verify_decision(scan)


if __name__ == "__main__":
    unittest.main()
