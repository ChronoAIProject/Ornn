"""Ornn acceptance cases for the real vendored scanner and Gitleaks binary."""

import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import string
import subprocess
import tarfile
import tempfile
import unittest
import zipfile

from staging_scan_inputs import prepare
from staging_scan_decision import verify_decision
SCANNER = Path(__file__).resolve().parent / "image-secret-scan" / "scan-image-secrets.sh"


def tar_bytes(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        for name, content in files:
            entry = tarfile.TarInfo(name)
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))
    return output.getvalue()


def saved_image(path, files):
    layer = tar_bytes(files)
    config = json.dumps({
        "architecture": "amd64", "os": "linux",
        "rootfs": {"type": "layers", "diff_ids": ["sha256:" + hashlib.sha256(layer).hexdigest()]},
        "config": {"Cmd": ["/bin/false"]}, "history": [{"created_by": "acceptance fixture"}],
    }).encode()
    config_name = hashlib.sha256(config).hexdigest() + ".json"
    manifest = json.dumps([{"Config": config_name, "RepoTags": [], "Layers": ["layer.tar"]}]).encode()
    path.write_bytes(tar_bytes([("manifest.json", manifest), (config_name, config), ("layer.tar", layer)]))


def fake_token():
    # Nonfunctional random bytes, generated at runtime; never store actual credentials.
    return ("ghp_" + "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(36))).encode()


def zip_bytes(name, content):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, content)
    return output.getvalue()


class SharedGateAcceptanceTests(unittest.TestCase):
    def scan(self, files, expected, forbidden=(), mode="all"):
        with tempfile.TemporaryDirectory(prefix="ornn-scan-acceptance-") as temp:
            root = Path(temp)
            archive = root / "image.tar"
            saved_image(archive, files)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            run = subprocess.run([
                "bash", str(SCANNER), str(archive), "--input-kind", "archive",
                "--blocking-rules", mode,
                "--output", str(root / "report"), "--expected-archive-sha256", digest,
            ], capture_output=True, timeout=60, check=False)
            report_bytes = (root / "report/REPORT.json").read_bytes()
            text_bytes = (root / "report/REPORT.txt").read_bytes()
            for value in forbidden:
                self.assertFalse(value in report_bytes + text_bytes + run.stdout + run.stderr,
                                 "Generated test token must not appear in any public output")
            report = json.loads(report_bytes)
            self.assertEqual(run.returncode, expected, report.get("error", report.get("status")))
            self.assertEqual(report["complete"], expected != 2)
            self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), digest)
            return report

    def test_policy_a_receipt_records_entropy_but_rejects_credentials(self):
        token = secrets.token_urlsafe(48).encode()
        report = self.scan([("app/bundle.js", token)], 0, [token], mode="credential")
        decision = verify_decision(report)
        self.assertGreater(decision["counts"]["advisory"], 0)
        credential = fake_token()
        report = self.scan([("app/bundle.js", credential)], 1, [credential], mode="credential")
        with self.assertRaises(ValueError):
            verify_decision(report)

    def test_plaintext_debian_gzip_names_preserve_detection(self):
        path = "var/lib/dpkg/alternatives/builtins.7.gz"
        self.scan([(path, b"auto\n/usr/share/man/man7/builtins.7.gz\n")], 0)
        token = fake_token()
        report = self.scan([(path, token)], 1, [token])
        self.assertTrue(any(item["rule"] == "gitleaks.github-pat" for item in report["findings"]))

    def test_real_gzip_and_disguised_archives_are_scanned(self):
        token = fake_token()
        for name, data in (("app/data.gz", gzip.compress(token)),
                           ("app/data.dat", zip_bytes("value", token)),
                           ("app/nested.zip", zip_bytes("inner.dat", zip_bytes("value", token)))):
            with self.subTest(name=name):
                report = self.scan([(name, data)], 1, [token])
                self.assertTrue(any(item["rule"] == "gitleaks.github-pat" for item in report["findings"]))

    def test_corrupt_binary_gzip_cannot_be_treated_as_plaintext(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            saved_image(root / "image.tar", [("app/broken.gz", b"\xff\xfe\x00")])
            with self.assertRaises(UnicodeDecodeError):
                prepare(root / "image.tar", root / "inputs")

    def test_all_owner_credential_path_classes_block_publication(self):
        paths = [
            "app/cert.pem", "app/key.key", "app/key.p12", "app/key.pfx", "root/.netrc",
            "root/.git-credentials", "root/.npmrc", "root/.pypirc", "etc/pip.conf",
            "root/.docker/config.json", "root/.cargo/credentials", "root/.cargo/credentials.toml",
            "root/.kube/config", "app/kubeconfig", "app/kubeconfig.yaml", "app/kubeconfig.yml",
            "app/production.kubeconfig", "app/kubeconfig-production", "app/service-account.json",
            "app/service_account.json", "app/application_default_credentials.json",
            "app/.env", "app/.envrc", "root/.git/config",
        ]
        report = self.scan([(name, b"synthetic nonsecret file") for name in paths], 1)
        entries = {item["entry"] for item in report["findings"] if item["rule"].startswith("path.")}
        # Ornn retains its stricter path preflight alongside the unchanged shared
        # scanner. Every owner-listed class must be rejected by the combined gate.
        for index in set(range(len(paths))) - entries:
            with self.subTest(path=paths[index]), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                saved_image(root / "image.tar", [(paths[index], b"synthetic nonsecret file")])
                with self.assertRaisesRegex(ValueError, "credential paths"):
                    prepare(root / "image.tar", root / "inputs")

    def test_generic_entropy_and_binary_private_key_headers_block(self):
        # The scanner must catch an opaque token with no provider prefix or variable name.
        token = secrets.token_urlsafe(48).encode()
        report = self.scan([("app/bundle.js", token)], 1, [token])
        self.assertTrue(any(item["rule"] == "gitleaks.image-high-entropy" for item in report["findings"]))
        header = b"\x00\xff-----BEGIN " + b"PRIVATE KEY-----\ninvalid synthetic material"
        report = self.scan([("app/data.bin", header)], 1)
        self.assertTrue(any(item["rule"] == "content.private-key-header" for item in report["findings"]))

    def test_depth_errors_never_disclose_filename_tokens(self):
        token = fake_token()
        nested = b"ordinary public text"
        for index in range(12):
            nested = zip_bytes("nested.zip", nested)
        report = self.scan([(token.decode() + ".pem", b"public text"), ("deep.zip", nested)], 2, [token])
        self.assertEqual(report["status"], "ERROR")


if __name__ == "__main__":
    os.umask(0o077)
    unittest.main()
