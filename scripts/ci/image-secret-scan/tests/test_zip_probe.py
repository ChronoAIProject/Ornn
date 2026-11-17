"""Real-artifact regression: incidental ZIP markers in ordinary binary files."""

import importlib.util
import io
import marshal
import struct
import unittest
import zipfile
from unittest.mock import patch

from image_secrets.backend import Gitleaks
from image_secrets.containers import identify
from tests import test_review_regressions as regression
from tests.test_review_regressions import token, zip_bytes


class ZipProbeTests(unittest.TestCase):
    setUp = regression.ReviewRegressions.setUp
    tearDown = regression.ReviewRegressions.tearDown
    scan = regression.ReviewRegressions.scan

    def test_valid_python_bytecode_with_zip_constants_still_scans_raw_bytes(self):
        source = (
            "ZIP_LOCAL = b'PK\\x03\\x04'\nZIP_CENTRAL = b'PK\\x01\\x02'\n"
            "ZIP_END = b'PK\\x05\\x06'\n"
            "PUBLIC_DESCRIPTION = 'Ordinary ZIP format constants; no credentials.'\n"
        )
        private_value = token()
        for credential in (None, private_value):
            code = compile(
                source + ("VALUE = " + repr(credential) if credential else ""), "format_constants.py", "exec"
            )
            payload = importlib.util.MAGIC_NUMBER + bytes(12) + marshal.dumps(code)
            for name in ("app/zipimport.cpython-313.pyc", "renamed.dat"):
                report = self.scan([(name, payload)], 1 if credential else 0, credential)
                if credential:
                    self.assertIn("gitleaks.github-pat", {f["rule"] for f in report["findings"]})

    def test_incidental_eocd_is_not_an_archive_or_a_file_exemption(self):
        # Mirrors the Python bytecode failure: no leading ZIP header, impossible
        # central-directory size. Never embed the real artifact or a live secret.
        marker = struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, 1, 1, 50000, 0, 0)
        data = b"ordinary binary bytecode fixture\x00" + marker
        self.scan([("package.dat", data)], 0)
        private_value = token()
        report = self.scan(
            [("package.dat", data + b'\ntoken="' + private_value.encode() + b'"\n')], 1, private_value
        )
        self.assertIn("gitleaks.github-pat", {f["rule"] for f in report["findings"]})

    def test_raw_detector_failure_after_false_zip_marker_fails_closed(self):
        marker = struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, 1, 1, 50000, 0, 0)
        original_scan = Gitleaks.scan

        def failing_layer(backend, stage, locations, findings):
            if stage.name == "layer":
                raise OSError("synthetic unsafe error message must not escape")
            return original_scan(backend, stage, locations, findings)

        with patch.object(Gitleaks, "scan", failing_layer):
            report = self.scan([("app/format.pyc", b"ordinary binary" + marker)], 2, shell=False)
        self.assertEqual(report["error"], "scanner-operation-failed")

    def test_prefixed_zip_secret_is_scanned(self):
        private_value = token()
        data = b"public executable prefix" + zip_bytes("inner.dat", private_value.encode())
        report = self.scan([("renamed.dat", data)], 1, private_value)
        self.assertTrue(any(f.get("member") == "0" for f in report["findings"]))

    def test_prefixed_encrypted_and_corrupt_zip_fail_closed(self):
        original = bytearray(zip_bytes("data.txt", b"public text"))
        encrypted = original.copy()
        encrypted[6] |= 1
        central = encrypted.index(b"PK\x01\x02")
        encrypted[central + 8] |= 1
        report = self.scan([("data.dat", b"prefix" + encrypted)], 2)
        self.assertEqual(report["error"], "encrypted-nested-archive")
        original[0:4] = b"BAD!"
        report = self.scan([("data.dat", b"prefix" + original)], 2)
        self.assertEqual(report["error"], "nested-zip-decode-failed")

    def test_zip64_prefix_and_damaged_directory(self):
        original = zip_bytes("data.txt", b"public text")
        fields = struct.unpack("<4s4H2LH", original[-22:])
        zip64 = struct.pack(
            "<4sQ2H2L4Q", b"PK\x06\x06", 44, 45, 45, 0, 0, fields[4], fields[4], fields[5], fields[6]
        )
        locator = struct.pack("<4sLQL", b"PK\x06\x07", 0, len(original) - 22, 1)
        data = original[:-22] + zip64 + locator + original[-22:]
        self.scan([("data.dat", b"prefix" + data)], 0)
        damaged = bytearray(original)
        struct.pack_into("<L", damaged, len(damaged) - 10, 50000)
        self.scan([("data.dat", b"prefix" + damaged)], 2)

    def test_empty_prefix_and_comment_markers(self):
        empty = io.BytesIO()
        with zipfile.ZipFile(empty, "w"):
            pass
        self.scan([("empty.dat", b"prefix" + empty.getvalue())], 0)
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("plain", b"public data")
            archive.comment = b"comment with PK\x05\x06 marker"
        physical = self.root / "comment.dat"
        physical.write_bytes(b"prefix" + data.getvalue())
        self.assertEqual(identify(physical), "zip")
        # stdlib rejects the misleading comment marker: recognition must still
        # hand it to the decoder, whose refusal is an ERROR rather than CLEAN.
        self.scan([("comment.dat", physical.read_bytes())], 2)

    def test_truncated_marker_and_comment_are_ordinary_binary(self):
        for data in [
            b"ordinary PK\x05\x06",
            b"ordinary" + struct.pack("<4s4H2LH", b"PK\x05\x06", 0, 0, 1, 1, 50000, 0, 50),
        ]:
            self.scan([("data.dat", data)], 0)
