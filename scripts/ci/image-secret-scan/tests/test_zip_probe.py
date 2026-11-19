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
from tests.archive_cases import forged_zip, packed_zip, prefix_crc, resized_compressed_extent


class ZipProbeTests(unittest.TestCase):
    setUp = regression.ReviewRegressions.setUp
    tearDown = regression.ReviewRegressions.tearDown
    scan = regression.ReviewRegressions.scan

    def test_arch02_forged_prefix_size_and_crc_refuse_hidden_credential(self):
        private_value = token()
        payload = b"Atoken=" + private_value.encode() + b"\n"
        report = self.scan([("data", forged_zip(payload, 1, prefix_crc()))], 2, private_value)
        self.assertEqual(report["error"], "zip-decoded-size-mismatch")

    def test_zip_declared_sizes_crc_and_compressed_extent_fail_closed(self):
        plain = b"ordinary public data"
        for data in (forged_zip(plain, 1), forged_zip(plain, len(plain) + 1),
                     forged_zip(plain, len(plain), 0), resized_compressed_extent(plain),
                     resized_compressed_extent(plain, suffix=b"", remove=1)):
            with self.subTest(length=len(data)):
                self.scan([("data", data)], 2)

    def test_zip_supported_methods_zip64_and_descriptors_decode_completely(self):
        for method in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA):
            for zip64, descriptor in ((False, False), (True, False), (False, True), (True, True)):
                with self.subTest(method=method, zip64=zip64, descriptor=descriptor):
                    self.scan([("data", packed_zip(b"ordinary public data", method, zip64, descriptor))], 0)

    def test_zip_empty_members_and_multiple_deflate_output_chunks(self):
        for payload in (b"", b"ordinary public data\n" * 60000):
            self.scan([("data", packed_zip(payload))], 0)

    def test_zip_directory_payload_and_unexplained_member_gap_refuse(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("folder/", b"hidden bytes")
        self.scan([("data", output.getvalue())], 2)
        data = bytearray(packed_zip(b"ordinary"))
        central = data.index(b"PK\x01\x02")
        data[central:central] = b"unexplained"
        struct.pack_into("<L", data, len(data) - 6, central + 11)
        report = self.scan([("data", bytes(data))], 2)
        self.assertEqual(report["error"], "zip-unexplained-member-data")

    def test_zip_local_size_and_descriptor_disagreement_refuse(self):
        data = bytearray(packed_zip(b"ordinary"))
        struct.pack_into("<L", data, 22, 1)
        report = self.scan([("data", bytes(data))], 2)
        self.assertEqual(report["error"], "zip-local-header-mismatch")
        data = bytearray(packed_zip(b"ordinary", descriptor=True))
        descriptor = data.index(b"PK\x07\x08")
        struct.pack_into("<L", data, descriptor + 12, 1)
        report = self.scan([("data", bytes(data))], 2)
        self.assertEqual(report["error"], "zip-data-descriptor-mismatch")

    def test_zip_other_codecs_cannot_hide_output_or_trailing_streams(self):
        for method in (zipfile.ZIP_STORED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA):
            for data in (forged_zip(b"Ahidden payload", 1, prefix_crc(), method),
                         resized_compressed_extent(b"ordinary", method=method)):
                with self.subTest(method=method):
                    self.scan([("data", data)], 2)

    def test_zip64_local_extra_fields_and_lzma_properties_are_bounded(self):
        original = bytearray(packed_zip(b"ordinary", zip64=True))
        names, = struct.unpack_from("<H", original, 26)
        extra = 30 + names
        for kind, length in ((1, 1), (1, 65535), (2, 16)):
            data = original.copy()
            struct.pack_into("<HH", data, extra, kind, length)
            self.scan([("data", bytes(data))], 2)
        data = bytearray(packed_zip(b"ordinary", zipfile.ZIP_LZMA))
        names, extras = struct.unpack_from("<HH", data, 26)
        struct.pack_into("<H", data, 30 + names + extras + 2, 65535)
        self.scan([("data", bytes(data))], 2)

    def test_zip_duplicate_offsets_and_invalid_descriptor_signature_refuse(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr("one", b"public")
            archive.writestr("two", b"public")
        data = bytearray(output.getvalue())
        first = data.index(b"PK\x01\x02")
        second = data.index(b"PK\x01\x02", first + 4)
        struct.pack_into("<L", data, second + 42, 0)
        report = self.scan([("data", bytes(data))], 2)
        self.assertEqual(report["error"], "zip-overlapping-members")
        data = bytearray(packed_zip(b"ordinary", descriptor=True))
        descriptor = data.index(b"PK\x07\x08")
        data[descriptor:descriptor + 4] = b"BAD!"
        self.scan([("data", bytes(data))], 2)

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
