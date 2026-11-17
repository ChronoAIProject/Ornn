"""Synthetic reviews below are test-only and never authorize image publication."""

import contextlib
import copy
import io
import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

SCANNER = Path(os.environ["TEST_SCANNER"])
sys.path[:0] = [str(SCANNER), str(Path(__file__).resolve().parents[1] / "tool")]
import scan_image_secrets
from content_catalog import (
    match_findings,
    path_hash,
    read_catalog,
    tool_identity,
)
from content_identity import archive_identities, layer_identities, resolve, target_path
from image_secrets.common import ScanError, digest_file
from image_secrets.gate import assess
from resolve_content_policy import main
from tests.fixtures import digest, docker_archive, tar_bytes


class ContentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "image.tar"
        self.data = b"public fixture text\n"
        docker_archive(
            self.archive,
            [
                tar_bytes(
                    [
                        ("cert.pem", self.data),
                        ("alias.pem", (tarfile.SYMTYPE, "cert.pem")),
                    ]
                )
            ],
        )
        self.raw = self.root / "raw"
        with (
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            code = scan_image_secrets.main(
                [
                    str(self.archive),
                    "--input-kind",
                    "archive",
                    "--blocking-rules",
                    "credential",
                    "--output",
                    str(self.raw),
                ]
            )
        self.assertEqual(code, 1)
        self.report = json.loads((self.raw / "REPORT.json").read_text())
        self.catalog = {
            "schema": "image-secret-content-policy-v1",
            "scanner_version": "1.0.3",
            "gitleaks_version": self.report["gitleaks_version"],
            **self.report["policy"],
            "entries": [
                {
                    "component": "web",
                    "path": p,
                    "rule": "path.key-or-certificate",
                    "file_sha256": digest(self.data),
                    "classification": "public-material",
                    "reason": "Synthetic public fixture only.",
                }
                for p in ("cert.pem", "alias.pem")
            ],
        }
        self.catalog_path = self.root / "catalog.json"
        self.save_catalog()
        self.review_path = self.root / "review.json"
        self.save_review()

    def save_catalog(self):
        self.catalog_path.write_text(json.dumps(self.catalog))

    def save_review(self):
        self.review_path.write_text(
            json.dumps(
                {
                    "verdict": "GO_CONTENT_POLICY",
                    "reviewer": "solution-architect-01",
                    "catalog_sha256": digest_file(self.catalog_path),
                    "adapter_files": tool_identity(),
                    "test_only": True,
                }
            )
        )

    def identities(self):
        workspace = self.root / "workspace"
        workspace.mkdir(exist_ok=True)
        return archive_identities(self.archive, workspace, self.report)

    def run_adapter(self, extra=(), expected=0):
        out = self.root / ("assessment" + str(len(list(self.root.glob("assessment*")))))
        argv = [
            "--scanner",
            str(SCANNER),
            "--archive",
            str(self.archive),
            "--report",
            str(self.raw / "REPORT.json"),
            "--catalog",
            str(self.catalog_path),
            "--component",
            "web",
            "--output",
            str(out),
        ]
        argv += list(extra) if extra else ["--review", str(self.review_path)]
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream), contextlib.redirect_stderr(stream):
            self.assertEqual(main(argv), expected)
        self.assertEqual(list(out.glob("identity-*")), [])
        return out, stream.getvalue()

    def test_full_adapter_consumable_packet(self):
        out, _ = self.run_adapter()
        assessed = json.loads((out / "REPORT.json").read_text())
        self.assertEqual(assessed["counts"]["reviewed"], 2)
        self.assertEqual(assessed["findings"], self.report["findings"])
        original = copy.deepcopy(self.report)
        assess(original, "credential", out / "classifications.json")
        self.assertEqual(original["counts"]["blocking"], 0)

    def test_unknown_and_changed_bytes_remain_blocking(self):
        self.catalog["entries"][0]["file_sha256"] = "0" * 64
        self.save_catalog()
        self.save_review()
        out, _ = self.run_adapter(expected=1)
        self.assertEqual(
            json.loads((out / "REPORT.json").read_text())["counts"]["blocking"], 1
        )

    def test_real_always_blocks(self):
        self.catalog["entries"][0]["classification"] = "REAL"
        self.save_catalog()
        self.save_review()
        out, _ = self.run_adapter(expected=1)
        self.assertEqual(
            json.loads((out / "REPORT.json").read_text())["counts"]["blocking"], 1
        )

    def test_proposal_cannot_emit_clean(self):
        out, _ = self.run_adapter(["--proposal"], expected=1)
        self.assertFalse((out / "REPORT.json").exists())
        self.assertFalse((out / "classifications.json").exists())

    def test_review_mismatch_fails_closed(self):
        self.catalog["entries"][0]["reason"] = "Changed review semantics."
        self.save_catalog()
        self.run_adapter(expected=2)

    def test_error_and_archive_mismatch_fail_closed(self):
        for change in (
            {"complete": False},
            {"archive_sha256": "0" * 64},
            {"scanner_files": {}},
        ):
            (self.raw / "REPORT.json").write_text(
                json.dumps(dict(self.report, **change))
            )
            _, output = self.run_adapter(expected=2)
            self.assertNotIn(str(self.archive), output)

    def test_component_path_rule_candidate_line_are_exact(self):
        index = read_catalog(self.catalog_path, self.report)
        ids = self.identities()
        finding = self.report["findings"][0]
        for field, value in [
            ("path", path_hash("other.pem")),
            ("rule", "gitleaks.github-pat"),
        ]:
            matched, pending = match_findings(
                index, "web", [dict(finding, **{field: value})], ids
            )
            self.assertFalse(matched)
            self.assertEqual(len(pending), 1)
        self.assertFalse(match_findings(index, "api", [finding], ids)[0])
        self.catalog["entries"][0].update(candidate_sha256="0" * 64, line=99)
        self.save_catalog()
        self.assertFalse(
            match_findings(
                read_catalog(self.catalog_path, self.report), "web", [finding], ids
            )[0]
        )

    def test_invalid_catalogs(self):
        original = copy.deepcopy(self.catalog)
        for field, value in [
            ("schema", "unknown"),
            ("scanner_version", "0"),
            ("allowlist_sha256", "0"),
        ]:
            self.catalog = dict(original, **{field: value})
            self.save_catalog()
            with self.assertRaises(ScanError):
                read_catalog(self.catalog_path, self.report)
        self.catalog = original
        self.catalog["entries"][0]["classification"] = "ignore"
        self.save_catalog()
        with self.assertRaises(ScanError):
            read_catalog(self.catalog_path, self.report)

    def test_ambiguous_classification_is_error(self):
        self.catalog["entries"].append(
            dict(self.catalog["entries"][0], classification="REAL")
        )
        self.save_catalog()
        with self.assertRaises(ScanError):
            match_findings(
                read_catalog(self.catalog_path, self.report),
                "web",
                self.report["findings"],
                self.identities(),
            )

    def test_entropy_only_advisory_and_missing_identity_block(self):
        finding = self.report["findings"][0]
        index = read_catalog(self.catalog_path, self.report)
        self.assertEqual(
            match_findings(
                index, "web", [dict(finding, rule="gitleaks.image-high-entropy")], {}
            ),
            ([], []),
        )
        self.assertEqual(len(match_findings(index, "web", [finding], {})[1]), 1)

    def test_symlink_target_change_cannot_reuse_approval(self):
        state = {
            "cert.pem": ("file", digest(b"changed")),
            "alias.pem": ("link", "cert.pem"),
        }
        self.assertNotEqual(resolve(state, "alias.pem"), digest(self.data))
        state["cert.pem"] = ("link", "alias.pem")
        self.assertIsNone(resolve(state, "alias.pem"))
        self.assertIsNone(resolve({}, "absent"))
        self.assertIsNone(resolve({"a": ("other", None)}, "a"))
        self.assertEqual(
            resolve({"d": ("link", "real"), "real/a": ("file", "hash")}, "d/a"), "hash"
        )
        self.assertEqual(target_path("dir/a", "../cert.pem"), "cert.pem")
        self.assertEqual(target_path("dir/a", "/cert.pem"), "cert.pem")
        with self.assertRaises(ScanError):
            target_path("a", "invalid\x00name")

    def test_duplicate_paths_and_whiteouts_preserve_old_identity(self):
        path = self.root / "layer.tar"
        path.write_bytes(tar_bytes([("cert.pem", self.data), ("cert.pem", b"changed")]))
        row = dict(self.report["findings"][0], entry=0)
        state = {}
        identities = layer_identities(path, state, {0: [row]})
        self.assertEqual(identities[row["finding_id"]], digest(self.data))
        self.assertEqual(state["cert.pem"][1], digest(b"changed"))
        path.write_bytes(tar_bytes([(".wh.cert.pem", b"")]))
        layer_identities(path, state, {})
        self.assertNotIn("cert.pem", state)
        state.update({"dir/file": ("file", "old"), "else/file": ("file", "keep")})
        path.write_bytes(tar_bytes([("dir/.wh..wh..opq", b"")]))
        layer_identities(path, state, {})
        self.assertNotIn("dir/file", state)
        self.assertIn("else/file", state)

    def test_wrong_path_file_hash_and_metadata_never_match(self):
        path = self.root / "layer.tar"
        path.write_bytes(tar_bytes([("cert.pem", self.data)]))
        row = self.report["findings"][0]
        for changes in ({"path": path_hash("other")}, {"file_sha256": "0" * 64}):
            self.assertEqual(
                layer_identities(path, {}, {0: [dict(row, **changes)]}), {}
            )

    def test_tar_metadata_cannot_borrow_public_payload_approval(self):
        path = self.root / "metadata-layer.tar"
        with tarfile.open(path, "w", format=tarfile.PAX_FORMAT) as layer:
            entry = tarfile.TarInfo("cert.pem")
            entry.size = len(self.data)
            entry.pax_headers = {
                "comment": "https://fixture:nonfunctional@example.invalid"
            }
            layer.addfile(entry, io.BytesIO(self.data))
        row = dict(self.report["findings"][0], rule="content.credential-url")
        self.assertEqual(layer_identities(path, {}, {0: [row]}), {})

    def test_archive_inventory_mismatch(self):
        for images in (
            [],
            [dict(self.report["inventory"]["images"][0], config_digest="unknown")],
        ):
            self.report["inventory"]["images"] = images
            with self.assertRaises(ScanError):
                self.identities()


if __name__ == "__main__":
    unittest.main()
