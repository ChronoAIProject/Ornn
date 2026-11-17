"""Regression tests for staging publication trust boundaries (no Docker needed)."""

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import tempfile
import tarfile
import unittest
from unittest.mock import patch

from staging_image import SOURCE, guard, main, publication, verify_archive, verify_loaded
from staging_scan_receipt import PREFLIGHT, checksum, scanner_identity, verify_image_scan_receipt
from staging_content_receipt import adapter_identity


class StagingImageTests(unittest.TestCase):
    def setUp(self):
        scanner_temp = tempfile.TemporaryDirectory()
        self.addCleanup(scanner_temp.cleanup)
        self.scanner = Path(scanner_temp.name)
        (self.scanner / "image_secrets").mkdir()
        for name in ("scan-image-secrets.sh", "scan_image_secrets.py", "image_secrets/engine.py",
                     "gitleaks.toml", "allowlist.json"):
            (self.scanner / name).write_text("test scanner fixture: " + name)
        scanner_patch = patch("staging_scan_receipt.SCANNER", self.scanner)
        scanner_patch.start()
        self.addCleanup(scanner_patch.stop)
        self.allowlist = self.scanner / "ornn-image-allowlist.json"
        self.allowlist.write_text("test reviewed policy fixture")
        policy_patch = patch("staging_scan_receipt.ALLOWLIST", self.allowlist)
        policy_patch.start()
        self.addCleanup(policy_patch.stop)
        self.catalog = self.scanner / "catalog.json"
        self.review = self.scanner / "review.json"
        for name, path in (("CATALOG", self.catalog), ("REVIEW", self.review)):
            target = patch("staging_content_receipt." + name, path)
            target.start()
            self.addCleanup(target.stop)
        self.env = {
            "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "ChronoAIProject/Ornn",
            "GITHUB_SHA": "a" * 40, "GITHUB_REF": "refs/heads/develop",
            "GITHUB_EVENT_NAME": "push", "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "1", "RUNNER_ARCH": "X64", "COMPONENT": "api",
        }
        self.tree = "b" * 40
        self.image = {
            "Id": "sha256:" + "c" * 64, "Os": "linux", "Architecture": "amd64",
            "Config": {"User": "1000:1000", "ExposedPorts": {"3802/tcp": {}}, "Labels": {
                "org.opencontainers.image.source": SOURCE,
                "org.opencontainers.image.revision": self.env["GITHUB_SHA"],
                "org.opencontainers.image.version": "git-" + self.env["GITHUB_SHA"],
            }}, "RootFS": {"Layers": ["sha256:" + "d" * 64]},
        }
        config = json.dumps({
            "architecture": "amd64", "os": "linux", "config": self.image["Config"],
            "rootfs": {"diff_ids": self.image["RootFS"]["Layers"]},
        }).encode()
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w:gz") as saved:
            for name, content in (("config.json", config),
                                  ("manifest.json", b'[{"Config":"config.json"}]')):
                entry = tarfile.TarInfo(name)
                entry.size = len(content)
                saved.addfile(entry, io.BytesIO(content))
        self.archive_data = stream.getvalue()
        self.metadata = {
            "schema": "ornn-ci-native-image-v1", "component": "api", "source": SOURCE,
            "sourceRevision": self.env["GITHUB_SHA"], "sourceTree": self.tree,
            "platform": "linux/amd64", "user": "1000:1000",
            "imageId": self.image["Id"], "labels": self.image["Config"]["Labels"],
            "configDigest": "sha256:" + hashlib.sha256(config).hexdigest(),
            "layerDiffIds": self.image["RootFS"]["Layers"],
            "archive": "ornn-api-linux-amd64.docker.tar.gz", "archiveBytes": len(self.archive_data),
            "archiveSha256": hashlib.sha256(self.archive_data).hexdigest(),
            "workflow": {
                "repository": self.env["GITHUB_REPOSITORY"], "runId": "123",
                "runAttempt": "1", "ref": self.env["GITHUB_REF"], "event": "push",
            }, "checks": {
                "numericNonroot": True, "nativeAmd64": True, "sourceLabels": True,
                "containerSmoke": True, "DBIdentityOrClusterQualification": False,
            },
        }

    def write_content_receipt(self, directory):
        report_path = directory / "secret-scan/REPORT.json"
        scan = json.loads(report_path.read_text())
        (directory / "secret-scan-raw").mkdir(exist_ok=True)
        raw_path = directory / "secret-scan-raw/REPORT.json"
        raw_path.write_text(json.dumps(scan))
        self.catalog.write_text(json.dumps({
            "schema": "image-secret-content-policy-v1", "scanner_version": "1.0.3",
            "gitleaks_version": "8.30.1", **scan["policy"], "entries": [],
        }))
        self.review.write_text(json.dumps({
            "verdict": "GO_CONTENT_POLICY", "reviewer": "solution-architect-01",
            "catalog_sha256": checksum(self.catalog), "adapter_files": adapter_identity(),
        }))
        self.review.with_suffix(".sha256").write_text(checksum(self.review) + "\n")
        packet_path = directory / "secret-scan/classifications.json"
        packet_path.write_text(json.dumps({
            "schema": "image-secret-classifications-v1",
            "archive_sha256": scan["archive_sha256"], "scanner_version": "1.0.3",
            **scan["policy"], "review": {
                "reviewer": "solution-architect-01",
                "reference": "content-policy-sha256:" + checksum(self.catalog),
                "report_sha256": checksum(self.review),
            }, "entries": [],
        }))
        scan["policy"].update(classifications_sha256=checksum(packet_path),
                              classification_review_sha256=checksum(self.review))
        report_path.write_text(json.dumps(scan))
        (directory / "secret-scan/RESOLUTION.json").write_text(json.dumps({
            "schema": "image-content-resolution-v1", "complete": True,
            "proposal": False, "status": "CLEAN", "unresolved": [], "matched": 0,
            "identities": {}, "archive_sha256": scan["archive_sha256"],
            "raw_report_sha256": checksum(raw_path), "catalog_sha256": checksum(self.catalog),
            "adapter_files": adapter_identity(), "packet_sha256": checksum(packet_path),
            "review_sha256": checksum(self.review), "report_sha256": checksum(report_path),
        }))

    def test_develop_push_publishes_and_dispatch_only_builds(self):
        for event, mode in (("push", "build"), ("push", "publish"),
                            ("workflow_dispatch", "build")):
            with self.subTest(event=event, mode=mode):
                self.env["GITHUB_EVENT_NAME"] = event
                guard(self.env, mode, "x86_64", self.env["GITHUB_SHA"])
        self.env["GITHUB_EVENT_NAME"] = "workflow_dispatch"
        with self.assertRaisesRegex(ValueError, "Event cannot publish"):
            guard(self.env, "publish", "x86_64", self.env["GITHUB_SHA"])

    def test_publication_rejects_untrusted_contexts(self):
        cases = {
            "GITHUB_ACTIONS": "false", "GITHUB_REPOSITORY": "fork/Ornn",
            "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "pull_request",
            "RUNNER_ARCH": "ARM64", "COMPONENT": "other", "GITHUB_SHA": "abc123",
            "GITHUB_RUN_ID": "", "GITHUB_RUN_ATTEMPT": "0",
        }
        for key, value in cases.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                guard({**self.env, key: value}, "publish", "x86_64", self.env["GITHUB_SHA"])
        for machine, head in (("arm64", self.env["GITHUB_SHA"]), ("x86_64", "b" * 40)):
            with self.subTest(machine=machine, head=head), self.assertRaises(ValueError):
                guard(self.env, "build", machine, head)

    def test_same_repository_pr_builds_but_never_publishes(self):
        self.env.update(GITHUB_EVENT_NAME="pull_request", GITHUB_REF="refs/pull/12/merge")
        event = {"pull_request": {
            "head": {"repo": {"full_name": self.env["GITHUB_REPOSITORY"]}},
            "base": {"ref": "develop"},
        }}
        guard(self.env, "build", "x86_64", self.env["GITHUB_SHA"], event)
        with self.assertRaises(ValueError):
            guard(self.env, "publish", "x86_64", self.env["GITHUB_SHA"], event)
        event["pull_request"]["head"]["repo"]["full_name"] = "fork/Ornn"
        with self.assertRaises(ValueError):
            guard(self.env, "build", "x86_64", self.env["GITHUB_SHA"], event)

    def write_archive(self, directory, metadata):
        (directory / "metadata.json").write_text(json.dumps(metadata))
        (directory / "image-inspect.json").write_text(json.dumps([self.image]))
        (directory / self.metadata["archive"]).write_bytes(self.archive_data)
        (directory / "scan-preflight.json").write_text(json.dumps({
            "schema": "ornn-image-preflight-v1", "archiveSha256": self.metadata["archiveSha256"],
            "extractorSha256": checksum(PREFLIGHT), "layers": 1, "files": 1, "credentialPaths": 0,
        }))
        (directory / "secret-scan").mkdir(exist_ok=True)
        (directory / "secret-scan/REPORT.json").write_text(json.dumps({
            "schema": "image-secret-scan-v1", "status": "CLEAN", "complete": True,
            "exit_code": 0, "findings": [], "allowlisted": [], "input_kind": "archive",
            "scanner_version": "1.0.3", "blocking_rules": "credential",
            "blocking_findings": [], "advisory_findings": [], "reviewed_classifications": [],
            "counts": {"detected": 0, "blocking": 0, "advisory": 0, "reviewed": 0, "allowlisted": 0},
            "gitleaks_version": "8.30.1", "archive_sha256": self.metadata["archiveSha256"],
            "scanner_files": scanner_identity(self.scanner),
            "policy": {"gitleaks_rules_sha256": checksum(self.scanner / "gitleaks.toml"),
                       "allowlist_sha256": checksum(self.allowlist)},
            "inventory": {"images": [{"index": 0, "config_digest": self.metadata["configDigest"],
                                      "layers": 1}],
                          "layers": [{"image": 0, "index": 0, "diff_id": self.metadata["layerDiffIds"][0]}],
                          "entries": 1}, "scanned_bytes": 100,
        }))
        self.write_content_receipt(directory)

    def test_archive_requires_scan_of_exact_image(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.write_archive(directory, self.metadata)
            scan_path = directory / "secret-scan/REPORT.json"
            scan = json.loads(scan_path.read_text())
            for field, value in (("status", "FINDINGS"), ("status", "ERROR"),
                                 ("complete", False), ("exit_code", 2), ("exit_code", False),
                                 ("findings", [{"rule": "synthetic"}]), ("error", "incomplete"),
                                 ("archive_sha256", "wrong"), ("policy", {}),
                                 ("scanner_files", {}), ("input_kind", "local-image"),
                                 ("gitleaks_version", "unknown"), ("schema", "old"),
                                 ("scanned_bytes", 0)):
                with self.subTest(field=field):
                    scan_path.write_text(json.dumps({**scan, field: value}))
                    with self.assertRaises(ValueError):
                        verify_archive(directory, self.env, self.tree)
            scan_path.unlink()
            with self.assertRaises(FileNotFoundError):
                verify_archive(directory, self.env, self.tree)

    def test_scan_rejects_missing_reordered_or_substituted_layers(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.write_archive(directory, self.metadata)
            scan_path = directory / "secret-scan/REPORT.json"
            scan = json.loads(scan_path.read_text())
            for section, index, key, value in (
                ("images", 0, "config_digest", "sha256:" + "f" * 64),
                ("images", 0, "layers", 0), ("images", 0, "index", 1),
                ("layers", 0, "diff_id", "sha256:" + "f" * 64),
                ("layers", 0, "index", 1), ("layers", 0, "image", 1),
            ):
                with self.subTest(section=section, key=key):
                    changed = copy.deepcopy(scan)
                    changed["inventory"][section][index][key] = value
                    scan_path.write_text(json.dumps(changed))
                    with self.assertRaises(ValueError):
                        verify_archive(directory, self.env, self.tree)
            for section in ("images", "layers"):
                changed = copy.deepcopy(scan)
                changed["inventory"][section] = []
                scan_path.write_text(json.dumps(changed))
                with self.assertRaises(ValueError):
                    verify_archive(directory, self.env, self.tree)

    def test_scan_rejects_changed_scanner_rules_or_allowlist(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for name in ("scan_image_secrets.py", "gitleaks.toml", "ornn-image-allowlist.json"):
                self.write_archive(directory, self.metadata)
                with (self.scanner / name).open("a") as stream:
                    stream.write("changed policy")
                with self.subTest(name=name), self.assertRaises(ValueError):
                    verify_archive(directory, self.env, self.tree)

    def test_archive_requires_matching_preflight(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.write_archive(directory, self.metadata)
            path = directory / "scan-preflight.json"
            preflight = json.loads(path.read_text())
            for field, value in (("archiveSha256", "wrong"), ("extractorSha256", "wrong"),
                                 ("layers", 0), ("files", 0), ("credentialPaths", 1)):
                path.write_text(json.dumps({**preflight, field: value}))
                with self.subTest(field=field), self.assertRaises(ValueError):
                    verify_archive(directory, self.env, self.tree)
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                verify_archive(directory, self.env, self.tree)

    def test_publication_scan_summary_excludes_detector_payloads(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.write_archive(directory, self.metadata)
            path = directory / "secret-scan/REPORT.json"
            report = json.loads(path.read_text())
            marker = secrets.token_urlsafe(48)
            report["unexpected_detector_payload"] = marker
            path.write_text(json.dumps(report))
            raw_path = directory / "secret-scan-raw/REPORT.json"
            raw = json.loads(raw_path.read_text())
            raw["unexpected_detector_payload"] = marker
            raw_path.write_text(json.dumps(raw))
            resolution_path = directory / "secret-scan/RESOLUTION.json"
            resolution = json.loads(resolution_path.read_text())
            resolution.update(raw_report_sha256=checksum(raw_path), report_sha256=checksum(path))
            resolution_path.write_text(json.dumps(resolution))
            summary = verify_image_scan_receipt(directory, self.metadata)
            self.assertFalse(marker in json.dumps(summary), "Detector payload escaped the metadata boundary")
            self.assertEqual(set(summary), {"schema", "status", "complete", "reportSha256", "archiveSha256",
                                           "gitleaksVersion", "policy", "scannerFiles", "layers", "preflightSha256",
                                           "blockingRules", "scannerVersion", "counts", "contentPolicy"})

    def test_archive_validates_before_load(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self.write_archive(directory, self.metadata)
            self.assertEqual(verify_archive(directory, self.env, self.tree), self.metadata)
            (directory / self.metadata["archive"]).write_bytes(b"x" * len(self.archive_data))
            with self.assertRaisesRegex(ValueError, "checksum"):
                verify_archive(directory, self.env, self.tree)
            (directory / self.metadata["archive"]).unlink()
            with self.assertRaises(FileNotFoundError):
                verify_archive(directory, self.env, self.tree)

    def test_archive_rejects_foreign_or_unqualified_metadata(self):
        mutations = [
            ("component", "web"), ("sourceRevision", "b" * 40),
            ("sourceTree", "c" * 40), ("archive", "../outside.tar.gz"),
            ("archiveBytes", 0), ("platform", "linux/arm64"), ("user", "0"),
            ("configDigest", "sha256:" + "f" * 64),
            ("workflow", {**self.metadata["workflow"], "runAttempt": "2"}),
            ("checks", {**self.metadata["checks"], "containerSmoke": False}),
            ("checks", {**self.metadata["checks"], "DBIdentityOrClusterQualification": True}),
        ]
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            for key, value in mutations:
                with self.subTest(key=key, value=value):
                    self.write_archive(directory, {**self.metadata, key: value})
                    with self.assertRaises(ValueError):
                        verify_archive(directory, self.env, self.tree)

    def test_loaded_image_identity_and_nonroot_contract(self):
        verify_loaded(self.image, self.metadata, self.env)
        for field, value in (("Id", "sha256:" + "e" * 64), ("Architecture", "arm64")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                verify_loaded({**self.image, field: value}, self.metadata, self.env)
        for user in ("", "root", "0:0", "1000"):
            changed = copy.deepcopy(self.image)
            changed["Config"]["User"] = user
            with self.subTest(user=user), self.assertRaises(ValueError):
                verify_loaded(changed, self.metadata, self.env)
        for label in self.image["Config"]["Labels"]:
            changed = copy.deepcopy(self.image)
            changed["Config"]["Labels"][label] = "wrong"
            with self.subTest(label=label), self.assertRaises(ValueError):
                verify_loaded(changed, self.metadata, self.env)

    def test_web_requires_uid_101(self):
        self.env["COMPONENT"] = "web"
        self.image["Config"]["User"] = "101:101"
        self.image["Config"]["ExposedPorts"] = {"8080/tcp": {}}
        self.image["Config"]["Labels"]["io.chronoai.ornn.web-build-identity"] = "web-" + "e" * 64
        self.metadata["webBuildIdentity"] = "web-" + "e" * 64
        verify_loaded(self.image, self.metadata, self.env)
        self.image["Config"]["User"] = "1000:1000"
        with self.assertRaises(ValueError):
            verify_loaded(self.image, self.metadata, self.env)

    def test_registry_manifest_binds_exact_config(self):
        digest = "sha256:" + "e" * 64
        manifest = {"schemaVersion": 2, "config": {"digest": self.metadata["configDigest"]}}
        receipt = publication(self.metadata, manifest, digest, self.env)
        self.assertEqual(receipt["image"], "ghcr.io/chronoaiproject/ornn-staging-api@" + digest)
        self.assertEqual(receipt["probes"], {"readiness": "/readyz", "liveness": "/health", "port": 3802})
        with self.assertRaisesRegex(ValueError, "digest"):
            publication(self.metadata, manifest, "latest", self.env)
        manifest["config"]["digest"] = "sha256:" + "f" * 64
        with self.assertRaisesRegex(ValueError, "differs"):
            publication(self.metadata, manifest, digest, self.env)

    def test_cli_handoff_and_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "staging-image-out"
            directory.mkdir()
            self.write_archive(directory, self.metadata)
            (directory / "loaded-inspect.json").write_text(json.dumps([self.image]))
            (directory / "remote-manifest.json").write_text(json.dumps({
                "schemaVersion": 2, "config": {"digest": self.metadata["configDigest"]},
            }))
            (directory / "push-digest.txt").write_text("sha256:" + "e" * 64)
            event = Path(temp) / "event.json"
            event.write_text("{}")
            summary = Path(temp) / "summary.md"
            self.env.update(GITHUB_EVENT_PATH=str(event), GITHUB_STEP_SUMMARY=str(summary))
            previous = Path.cwd()
            try:
                os.chdir(temp)
                with patch.dict(os.environ, self.env), patch("sys.stdout", new_callable=io.StringIO):
                    with patch("sys.argv", ["staging_image.py", "guard", "publish"]), \
                            patch("staging_image.platform.machine", return_value="x86_64"), \
                            patch("staging_image.subprocess.check_output", return_value=self.env["GITHUB_SHA"]):
                        main()
                    with patch("sys.argv", ["staging_image.py", "archive"]), \
                            patch("staging_image.subprocess.check_output", return_value=self.tree):
                        main()
                    for command in ("inspect", "loaded", "scan", "publication"):
                        with self.subTest(command=command), patch("sys.argv", ["staging_image.py", command]):
                            main()
                    with patch("sys.argv", ["staging_image.py", "unknown"]), self.assertRaises(ValueError):
                        main()
                receipt = json.loads((directory / "publication.json").read_text())
                self.assertIn(receipt["image"], summary.read_text())
                self.assertEqual(receipt["archiveSha256"], self.metadata["archiveSha256"])
                self.assertEqual(receipt["imageScan"]["status"], "CLEAN")
                self.assertEqual(receipt["imageScan"]["reportSha256"],
                                 checksum(directory / "secret-scan/REPORT.json"))
                # A replaced image must fail before a publication receipt is accepted.
                changed = copy.deepcopy(self.image)
                changed["Config"]["User"] = "0:0"
                (directory / "loaded-inspect.json").write_text(json.dumps([changed]))
                with patch.dict(os.environ, self.env), patch("sys.argv", ["staging_image.py", "loaded"]):
                    with self.assertRaisesRegex(ValueError, "runtime user"):
                        main()
            finally:
                os.chdir(previous)


if __name__ == "__main__":
    unittest.main()
