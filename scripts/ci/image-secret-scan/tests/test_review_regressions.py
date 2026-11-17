"""SA-01 R1/R2 regressions through the shipped interface; no live credentials."""

import bz2
import contextlib
import gzip
import io
import json
import lzma
import os
import secrets
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import scan_image_secrets as cli
from image_secrets.backend import Gitleaks
from tests.fixtures import docker_archive, tar_bytes


def token():
    return "ghp_" + "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(36))


def zip_bytes(name, content):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, content)
    return output.getvalue()


class ReviewRegressions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="scanner-r1-r2-")
        self.root = Path(self.temp.name)
        self.counter = 0

    def tearDown(self):
        self.temp.cleanup()

    def scan(self, entries, expected, private_value=None, shell=True):
        sequence = self.counter
        self.counter += 1
        archive = self.root / f"input-{sequence}.tar"
        output = self.root / f"report-{sequence}"
        docker_archive(archive, [tar_bytes(entries)])
        argv = [
            str(archive),
            "--input-kind",
            "archive",
            "--output",
            str(output),
            "--tmpdir",
            str(self.root),
            "--timeout",
            "20",
        ]
        if shell:
            process = subprocess.run(
                [str(cli.HERE / "scan-image-secrets.sh"), *argv],
                check=False,
                capture_output=True,
                timeout=60,
                env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),
            )
            code, console = process.returncode, process.stdout + process.stderr
        else:
            stream = io.StringIO()
            with contextlib.redirect_stdout(stream), contextlib.redirect_stderr(stream):
                code = cli.main(argv)
            console = stream.getvalue().encode()
        report = json.loads((output / "REPORT.json").read_bytes())
        all_output = console + (output / "REPORT.json").read_bytes() + (output / "REPORT.txt").read_bytes()
        self.assertEqual(code, expected, report.get("error"))
        self.assertEqual(report["scanner_version"], "1.0.1")
        self.assertEqual(report["complete"], expected != 2)
        if private_value:
            self.assertFalse(
                private_value.encode() in all_output, "credential-bearing filename was disclosed"
            )
        for finding in report["findings"] + report["allowlisted"]:
            self.assertRegex(finding["path"], r"^path-sha256:[0-9a-f]{64}$")
        self.assertFalse(list(self.root.glob("image-secret-scan-*")))
        return report

    def test_r1_real_depth_refusal_hashes_credential_filename(self):
        private_value = token()
        data, name = b"ordinary public data", "inner.txt"
        for _ in range(5):
            data, name = zip_bytes(name, data), "inner.dat"
        report = self.scan(
            [("app/" + private_value + ".pem", b"public placeholder"), ("outer.zip", data)], 2, private_value
        )
        self.assertEqual(report["error"], "nested-archive-depth-limit")
        self.assertTrue(report["findings"], "must retain opaque numeric/path-hash evidence")

    def test_r1_detector_timeout_malformed_report_and_partial_error(self):
        real_scan = Gitleaks.scan
        for failure in ["timeout", "malformed", "partial-error"]:
            private_value = token()

            def broken_scan(backend, stage, locations, findings, failure=failure):
                if stage.name != "layer":
                    return real_scan(backend, stage, locations, findings)
                if failure == "timeout":
                    raise subprocess.TimeoutExpired("gitleaks", 1)
                original_run = subprocess.run

                def bad_process(argv, **kwargs):
                    if argv[:2] != ["gitleaks", "dir"]:
                        return original_run(argv, **kwargs)
                    raw = backend.workspace / "gitleaks-private.json"
                    raw.write_text("{" if failure == "malformed" else "[]")
                    return subprocess.CompletedProcess(argv, 0 if failure == "malformed" else 2)

                with patch("image_secrets.backend.subprocess.run", side_effect=bad_process):
                    return real_scan(backend, stage, locations, findings)

            with patch.object(Gitleaks, "scan", broken_scan):
                report = self.scan(
                    [("app/" + private_value + ".pem", b"public placeholder")], 2, private_value, shell=False
                )
                self.assertTrue(report["findings"])

    def test_r2_identical_zip_detected_with_any_filename(self):
        private_value = token()
        data = zip_bytes("settings.txt", ("token=" + private_value).encode())
        for name in ["app/package.zip", "app/package.dat", "app/package", "app/package.pem"]:
            report = self.scan([(name, data)], 1, private_value)
            self.assertIn("gitleaks.github-pat", {f["rule"] for f in report["findings"]})

    def test_r2_all_supported_formats_detected_by_magic(self):
        private_value = token()
        plain = ("token=" + private_value + "\n").encode()
        zstd = subprocess.run(["zstd", "-q", "-c"], input=plain, check=True, capture_output=True).stdout
        formats = [
            zip_bytes("settings", plain),
            gzip.compress(plain),
            bz2.compress(plain),
            lzma.compress(plain),
            zstd,
            tar_bytes([("settings", plain)]),
        ]
        for data in formats:
            report = self.scan([("renamed.dat", data)], 1, private_value)
            self.assertIn("gitleaks.github-pat", {f["rule"] for f in report["findings"]})

    def test_r2_nested_disguised_mixed_formats(self):
        private_value = token()
        inner_tar = tar_bytes([("settings.txt", private_value.encode())])
        packed = gzip.compress(inner_tar)
        outer = zip_bytes("data.dat", packed)
        report = self.scan([("extensionless", outer)], 1, private_value)
        self.assertTrue(any(f.get("member") == "0/0/0" for f in report["findings"]))

    def test_corrupt_or_unsupported_magic_fails_closed(self):
        broken_tar = bytearray(512)
        broken_tar[257:262] = b"ustar"
        for data in [
            b"PK\x03\x04broken",
            b"\x1f\x8bbroken",
            b"BZhbroken",
            b"\xfd7zXZ\x00broken",
            b"\x28\xb5\x2f\xfdbroken",
            bytes(broken_tar),
            b"7z\xbc\xaf\x27\x1cbroken",
            b"Rar!\x1a\x07broken",
            b"\x50\x2a\x4d\x18\x00\x00\x00\x00",
        ]:
            self.scan([("plain.dat", data)], 2)

    def test_encrypted_zip_and_nested_path_escape_fail_closed(self):
        encrypted = bytearray(zip_bytes("settings.txt", b"public text"))
        encrypted[6] |= 1
        central = encrypted.index(b"PK\x01\x02")
        encrypted[central + 8] |= 1
        self.scan([("encrypted.dat", bytes(encrypted))], 2)
        self.scan([("escape.dat", zip_bytes("../escape", b"public text"))], 2)

    def test_clean_renamed_archives_and_prefixed_zip(self):
        plain = b"ordinary public data\n"
        for data in [
            zip_bytes("hello", plain),
            gzip.compress(plain),
            bz2.compress(plain),
            lzma.compress(plain),
            tar_bytes([("hello", plain)]),
            b"prefix" + zip_bytes("hello", plain),
        ]:
            self.scan([("without-extension", data)], 0)


if __name__ == "__main__":
    unittest.main()
