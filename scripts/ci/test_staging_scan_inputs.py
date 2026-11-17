"""Archive boundary regressions for the inline image scan."""
import io
import gzip
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from staging_scan_inputs import prepare, write_receipt
from staging_scan_receipt import checksum


def layer(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
        for name, content, kind in entries:
            item = tarfile.TarInfo(name)
            if kind == "link":
                item.type = tarfile.SYMTYPE
                item.linkname = content.decode()
                archive.addfile(item)
            else:
                item.size = len(content)
                archive.addfile(item, io.BytesIO(content))
    return stream.getvalue()


def saved_image(path, layers):
    files = {f"layer-{i}.tar.gz": content for i, content in enumerate(layers)}
    files["manifest.json"] = json.dumps([{
        "Config": "config.json", "Layers": list(files),
    }]).encode()
    files["config.json"] = b'{"config":{"Env":["MODE=test"]},"history":[{"created_by":"test build"}]}'
    with tarfile.open(path, "w:gz") as archive:
        for name, content in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))


class ScanInputTests(unittest.TestCase):
    def test_deleted_files_and_full_config_history_are_retained(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            saved_image(root / "image.tar.gz", [
                layer([("app/removed.txt", b"removed content", "file")]),
                layer([("app/.wh.removed.txt", b"", "file"), ("app/current.txt", b"current", "file")]),
            ])
            stats = prepare(root / "image.tar.gz", root / "scan")
            self.assertEqual(stats, {"layers": 2, "files": 3, "credentialPaths": 0})
            self.assertEqual((root / "scan/layers/0/app/removed.txt").read_bytes(), b"removed content")
            config = json.loads((root / "scan/metadata/config.json").read_text())
            self.assertEqual(config["config"]["Env"], ["MODE=test"])
            self.assertEqual(json.loads((root / "scan/metadata/history.json").read_text()), config["history"])

    def test_credential_paths_fail_even_when_deleted_later(self):
        for name in ("app/.env", "app/.envrc", "app/.environment", "root/.npmrc", "app/key.key",
                     "root/.kube/config", "root/.kube/config-dev", "app/kubeconfig", "etc/pip.conf",
                     "root/.netrc", "root/.docker/config.json", "root/.cargo/credentials.toml",
                     "etc/kubernetes/admin.conf", "app/service-account.json"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                saved_image(root / "image.tar.gz", [layer([(name, b"fixture", "file")])])
                with self.assertRaisesRegex(ValueError, "credential paths"):
                    prepare(root / "image.tar.gz", root / "scan")

    def test_links_are_recorded_without_following_them(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            saved_image(root / "image.tar.gz", [layer([("app/link", b"/etc/passwd", "link")])])
            prepare(root / "image.tar.gz", root / "scan")
            self.assertFalse((root / "scan/layers/0/app/link").exists())
            links = json.loads((root / "scan/metadata/links-0.json").read_text())
            self.assertEqual(links, [{"path": "app/link", "target": "/etc/passwd"}])

    def test_traversal_and_absolute_paths_fail(self):
        for name in ("../outside", "/outside", "app/../../outside"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                saved_image(root / "image.tar.gz", [layer([(name, b"fixture", "file")])])
                with self.assertRaisesRegex(ValueError, "Unsafe path"):
                    prepare(root / "image.tar.gz", root / "scan")

    def test_duplicate_entries_cannot_hide_overwritten_content(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            saved_image(root / "image.tar.gz", [layer([
                ("app/file", b"first", "file"), ("app/file", b"second", "file"),
            ])])
            with self.assertRaisesRegex(ValueError, "Duplicate file"):
                prepare(root / "image.tar.gz", root / "scan")

    def test_corrupt_archive_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "image.tar.gz").write_bytes(b"invalid archive")
            with self.assertRaises(tarfile.ReadError):
                prepare(root / "image.tar.gz", root / "scan")

    def test_plaintext_gzip_names_preserve_all_content(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plain = b"auto\n/usr/share/man/man7/builtins.7.gz\n"
            compressed = gzip.compress(b"compressed content")
            saved_image(root / "image.tar.gz", [layer([
                ("var/lib/dpkg/alternatives/builtins.7.gz", plain, "file"),
                ("app/real.gz", compressed, "file"),
            ])])
            prepare(root / "image.tar.gz", root / "scan")
            target = root / "scan/layers/0/var/lib/dpkg/alternatives/builtins.7_compressed.scan.txt"
            self.assertEqual(target.read_bytes(), plain)
            self.assertEqual((root / "scan/layers/0/app/real.gz").read_bytes(), compressed)

    def test_invalid_binary_gzip_input_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            saved_image(root / "image.tar.gz", [layer([("app/broken.gz", b"\xff\xfe\x00", "file")])])
            with self.assertRaises(UnicodeDecodeError):
                prepare(root / "image.tar.gz", root / "scan")

    def test_receipt_binds_unmodified_archive_and_extractor(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "image.tar.gz"
            saved_image(archive, [layer([("app/plain", b"hello", "file")])])
            digest = checksum(archive)
            stats = prepare(archive, root / "scan")
            write_receipt(archive, root / "receipt.json", stats, digest)
            report = json.loads((root / "receipt.json").read_text())
            self.assertEqual(report["archiveSha256"], digest)
            self.assertEqual(report["files"], 1)
            archive.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "Archive changed"):
                write_receipt(archive, root / "receipt.json", stats, digest)


if __name__ == "__main__":
    unittest.main()
