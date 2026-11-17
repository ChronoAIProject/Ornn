import contextlib
import io
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import scan_image_secrets as cli
from image_secrets.common import digest_file
from tests.fixtures import digest, docker_archive, fake_key, oci_archive, tar_bytes


class ScannerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="scanner-test-")
        self.root = Path(self.temp.name)
        self.counter = 0

    def tearDown(self):
        self.temp.cleanup()

    def scan(self, archive, expected, extra=()):
        output = self.root / f"report{self.counter}"
        self.counter += 1
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream), contextlib.redirect_stderr(stream):
            code = cli.main([str(archive), "--output", str(output), "--tmpdir", str(self.root), *extra])
        report = json.loads((output / "REPORT.json").read_text())
        self.assertEqual(code, expected, report.get("error"))
        self.assertEqual(report["exit_code"], expected)
        self.assertEqual(list(self.root.glob("image-secret-scan-*")), [])
        public = (
            stream.getvalue() + (output / "REPORT.json").read_text() + (output / "REPORT.txt").read_text()
        )
        return report, public

    def test_clean_docker_and_compressed_nested_oci(self):
        layer = tar_bytes([("hello.txt", b"Hello, world.\n")])
        for kind in ("docker", "oci"):
            path = self.root / (kind + ".tar")
            if kind == "docker":
                docker_archive(path, [layer])
            else:
                oci_archive(path, [layer], nested=True)
            report, _ = self.scan(path, 0)
            self.assertTrue(report["complete"])
            self.assertEqual(report["inventory"]["archive_format"], kind)
            self.assertEqual(report["inventory"]["layers"][0]["files"], 1)

    def test_deleted_key_and_duplicate_paths_still_detected(self):
        key = fake_key()
        first = tar_bytes([("app/signing.pem", key), ("app/signing.pem", b"overwritten\n")])
        second = tar_bytes([("app/.wh.signing.pem", b"")])
        archive = self.root / "deleted.tar"
        docker_archive(archive, [first, second])
        report, output = self.scan(archive, 1)
        self.assertIn("content.private-key-header", {f["rule"] for f in report["findings"]})
        self.assertEqual(report["inventory"]["layers"][0]["files"], 2)
        self.assertEqual(report["inventory"]["layers"][1]["whiteouts"], 1)
        self.assertNotIn(key.decode().splitlines()[1], output)

    def test_full_config_labels_env_command_entrypoint_and_history(self):
        token = "test_" + os.urandom(36).hex()
        archive = self.root / "config.tar"
        docker_archive(
            archive,
            [],
            {
                "config": {
                    "Env": ["DEPLOY_PASSWORD=" + token],
                    "Labels": {"client_secret": token},
                    "Cmd": ["api_key=" + token],
                    "Entrypoint": ["secret=" + token],
                },
                "history": [{"created_by": "ARG ACCESS_TOKEN=" + token, "empty_layer": True}],
            },
        )
        report, output = self.scan(archive, 1)
        paths = [f["path"] for f in report["findings"]]
        for pointer in (
            "config/config/Env/0",
            "config/config/Labels/client_secret/@assignment",
            "config/config/Cmd/0",
            "config/config/Entrypoint/0",
            "config/history/0/created_by",
        ):
            self.assertIn("path-sha256:" + digest(pointer.encode()), paths)
        self.assertNotIn(token, output)
        self.assertTrue(any(f["rule"].startswith("gitleaks.") for f in report["findings"]))

    def test_upstream_default_rule_cannot_be_disabled_by_image(self):
        token = "ghp_" + "".join(
            __import__("secrets").choice("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
            for _ in range(36)
        )
        layer = tar_bytes(
            [
                (".gitleaks.toml", b"title='ignore me'\n"),
                (".gitleaksignore", b"*\n"),
                ("vendor/token.txt", (token + " # gitleaks:allow\n").encode()),
            ]
        )
        archive = self.root / "ignored.tar"
        docker_archive(archive, [layer])
        report, output = self.scan(archive, 1)
        self.assertIn("gitleaks.github-pat", {f["rule"] for f in report["findings"]})
        self.assertNotIn(token, output)

    def test_entropy_without_provider_prefix_and_exact_public_allowlist(self):
        import base64

        value = base64.b64encode(os.urandom(60))
        archive = self.root / "entropy.tar"
        docker_archive(archive, [tar_bytes([("public.txt", b'value="' + value + b'"\n')])])
        report, output = self.scan(archive, 1)
        self.assertIn("gitleaks.image-high-entropy", {f["rule"] for f in report["findings"]})
        self.assertNotIn(value.decode(), output)
        allowlist = self.root / "allow.json"
        allowlist.write_text(
            json.dumps(
                {
                    "version": 1,
                    "entries": [
                        {
                            "id": "public-test-value",
                            "rule": "gitleaks.image-high-entropy",
                            "scope": "layer",
                            "path": "public.txt",
                            "match_sha256": digest(value),
                            "reason": "Runtime-generated noncredential test value.",
                        }
                    ],
                }
            )
        )
        clean, _ = self.scan(archive, 0, ["--allowlist", str(allowlist)])
        self.assertEqual(len(clean["allowlisted"]), 1)
        docker_archive(archive, [tar_bytes([("other.txt", b'value="' + value + b'"\n')])])
        self.scan(archive, 1, ["--allowlist", str(allowlist)])

    def test_targeted_paths_and_arbitrary_service_account(self):
        names = [
            "test.pem",
            "test.key",
            "id_rsa",
            "bundle.p12",
            "bundle.pfx",
            ".env.production",
            ".npmrc",
            ".pypirc",
            ".netrc",
            ".docker/config.json",
            "kubeconfig",
            "credentials.json",
            "service-account.json",
            ".git/config",
            ".aws/credentials",
            ".aws/config",
            ".config/gcloud/application_default_credentials.json",
            ".azure/accessTokens.json",
        ]
        archive = self.root / "paths.tar"
        docker_archive(
            archive,
            [
                tar_bytes(
                    [(name, b"noncredential fixture\n") for name in names]
                    + [("arbitrary.json", b'{"type":"service_account"}')]
                )
            ],
        )
        report, _ = self.scan(archive, 1)
        found = {f["path"] for f in report["findings"] if f["rule"].startswith("path.")}
        self.assertEqual(found, {"path-sha256:" + digest(name.encode()) for name in names})
        self.assertIn("content.service-account", {f["rule"] for f in report["findings"]})

    def test_links_never_followed_and_directory_git_detected(self):
        archive = self.root / "links.tar"
        docker_archive(
            archive,
            [
                tar_bytes(
                    [
                        ("harmless", (tarfile.SYMTYPE, "/etc/passwd")),
                        ("private.key", (tarfile.LNKTYPE, "../outside")),
                        (".git", (tarfile.DIRTYPE, "")),
                    ]
                )
            ],
        )
        report, _ = self.scan(archive, 1)
        self.assertEqual(report["inventory"]["layers"][0]["links"], 2)
        self.assertIn("path.git-metadata", {f["rule"] for f in report["findings"]})

    def test_traversal_duplicate_outer_and_bad_archive_fail_closed(self):
        for name, data in [
            ("invalid", b"not a tar"),
            ("traversal", tar_bytes([("../outside", b"x")])),
            ("duplicate", tar_bytes([("x", b"a"), ("./x", b"b")])),
        ]:
            archive = self.root / (name + ".tar")
            archive.write_bytes(data)
            report, _ = self.scan(archive, 2)
            self.assertFalse(report["complete"])
        archive = self.root / "layer-traversal.tar"
        docker_archive(archive, [tar_bytes([("../outside", b"x")])])
        self.scan(archive, 2)

    def test_integrity_and_budget_errors(self):
        archive = self.root / "clean.tar"
        docker_archive(archive, [tar_bytes([("file.txt", b"hello")])])
        self.scan(archive, 2, ["--expected-archive-sha256", "0" * 64])
        self.scan(archive, 0, ["--expected-archive-sha256", digest_file(archive)])
        self.scan(archive, 2, ["--max-bytes", "100"])
        self.scan(archive, 2, ["--max-entries", "1"])
        self.scan(archive, 2, ["--max-bytes", "0"])
        self.scan(archive, 2, ["--expected-archive-sha256", "bad"])
        docker_archive(
            archive, [tar_bytes([])], {"rootfs": {"type": "layers", "diff_ids": ["sha256:" + "0" * 64]}}
        )
        self.scan(archive, 2)

    def test_backend_error_and_missing_input_never_report_clean(self):
        archive = self.root / "missing.tar"
        self.scan(archive, 2, ["--input-kind", "archive"])
        docker_archive(archive, [tar_bytes([])])
        with patch("image_secrets.backend.Gitleaks.scan", side_effect=RuntimeError("secret must not escape")):
            _, output = self.scan(archive, 2)
            self.assertNotIn("secret must not escape", output)

    def test_existing_output_and_shell_exit_codes(self):
        archive = self.root / "clean.tar"
        docker_archive(archive, [tar_bytes([("hello", b"world")])])
        command = [
            str(cli.HERE / "scan-image-secrets.sh"),
            str(archive),
            "--output",
            str(self.root / "shell-report"),
        ]
        result = subprocess.run(command, check=False, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        result = subprocess.run(command, check=False, capture_output=True)
        self.assertEqual(result.returncode, 2)

    def test_real_clean_and_fake_key_images_via_docker(self):
        for dirty in (False, True):
            archive = self.root / ("dirty.tar" if dirty else "clean.tar")
            marker = str(uuid.uuid4()).encode()
            entries = [("fixture-id.txt", marker)]
            key = fake_key()
            if dirty:
                entries.append(("deleted.key", key))
            layers = [tar_bytes(entries)]
            if dirty:
                layers.append(tar_bytes([(".wh.deleted.key", b"")]))
            image_id = "scan-image-secrets-fixture:" + uuid.uuid4().hex
            docker_archive(archive, layers, tag=image_id)
            loaded = subprocess.run(
                ["docker", "load", "--input", str(archive)], check=False, capture_output=True, timeout=60
            )
            self.assertEqual(loaded.returncode, 0, "Docker fixture load failed")
            try:
                report, public = self.scan(image_id, 1 if dirty else 0, ["--input-kind", "image"])
                self.assertEqual(report["input_kind"], "local-image")
                self.assertNotIn(key.decode().splitlines()[1], public)
            finally:
                removed = subprocess.run(
                    ["docker", "image", "rm", image_id], check=False, capture_output=True, timeout=60
                )
                self.assertEqual(removed.returncode, 0, "Docker fixture cleanup failed")

    def test_binary_and_nested_archive_secret_detection(self):
        import zipfile

        key = fake_key()
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, "w") as archive:
            archive.writestr("inner.txt", key)
        archive = self.root / "nested.tar"
        docker_archive(
            archive, [tar_bytes([("binary.bin", b"\x00\x01" + key), ("bundle.zip", nested.getvalue())])]
        )
        report, _ = self.scan(archive, 1)
        self.assertTrue(
            any(
                f["path"] == "path-sha256:" + digest(b"binary.bin")
                and f["rule"] == "content.private-key-header"
                for f in report["findings"]
            )
        )
        self.assertTrue(
            any(
                f["path"] == "path-sha256:" + digest(b"bundle.zip!inner.txt")
                and f["rule"].startswith("gitleaks.")
                for f in report["findings"]
            )
        )

    def test_nested_archive_depth_limit_is_error_not_clean(self):
        import zipfile

        data = fake_key()
        name = "inner.txt"
        for _ in range(5):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as nested:
                nested.writestr(name, data)
            data, name = buffer.getvalue(), "inner.zip"
        archive = self.root / "deep.tar"
        docker_archive(archive, [tar_bytes([("outer.zip", data)])])
        self.scan(archive, 2)

    def test_empty_whiteout_and_reviewed_public_file_exception(self):
        archive = self.root / "whiteout.tar"
        docker_archive(archive, [tar_bytes([("etc/ssl/.wh.public.pem", b"")])])
        self.scan(archive, 0)
        body = b"Public test certificate placeholder.\n"
        docker_archive(archive, [tar_bytes([("public.pem", body)])])
        allowlist = self.root / "allow-file.json"
        allowlist.write_text(
            json.dumps(
                {
                    "version": 1,
                    "entries": [
                        {
                            "id": "public-file",
                            "rule": "path.key-or-certificate",
                            "scope": "layer",
                            "path": "public.pem",
                            "file_sha256": digest(body),
                            "reason": "Reviewed noncredential test file.",
                        }
                    ],
                }
            )
        )
        self.scan(archive, 0, ["--allowlist", str(allowlist)])
        docker_archive(archive, [tar_bytes([("public.pem", fake_key())])])
        self.scan(archive, 1, ["--allowlist", str(allowlist)])

    def test_low_entropy_url_and_split_command_credentials(self):
        archive = self.root / "credentials.tar"
        docker_archive(
            archive,
            [tar_bytes([("settings.txt", b"postgres://user:shortpass@db")])],
            {"config": {"Cmd": ["program", "--password", "shortpass"]}},
        )
        report, public = self.scan(archive, 1)
        rules = {f["rule"] for f in report["findings"]}
        self.assertIn("content.credential-url", rules)
        self.assertIn("config.secret-assignment", rules)
        self.assertNotIn("shortpass", public)


if __name__ == "__main__":
    unittest.main()
