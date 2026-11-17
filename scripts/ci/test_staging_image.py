"""Regression tests for staging publication trust boundaries (no Docker needed)."""

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import tarfile
import unittest
from unittest.mock import patch

from staging_image import SOURCE, guard, main, publication, verify_archive, verify_loaded


class StagingImageTests(unittest.TestCase):
    def setUp(self):
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

    def test_develop_push_and_dispatch_allowed(self):
        for event in ("push", "workflow_dispatch"):
            for mode in ("build", "publish"):
                with self.subTest(event=event, mode=mode):
                    self.env["GITHUB_EVENT_NAME"] = event
                    guard(self.env, mode, "x86_64", self.env["GITHUB_SHA"])

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
                    for command in ("inspect", "loaded", "publication"):
                        with self.subTest(command=command), patch("sys.argv", ["staging_image.py", command]):
                            main()
                    with patch("sys.argv", ["staging_image.py", "unknown"]), self.assertRaises(ValueError):
                        main()
                receipt = json.loads((directory / "publication.json").read_text())
                self.assertIn(receipt["image"], summary.read_text())
                self.assertEqual(receipt["archiveSha256"], self.metadata["archiveSha256"])
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
