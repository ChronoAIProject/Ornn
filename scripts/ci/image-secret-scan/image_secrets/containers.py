"""Magic-based nested container decoding, independent of names and Gitleaks dispatch."""

import bz2
import gzip
import json
import lzma
import subprocess
import tarfile
import threading
import zipfile

from .common import ScanError, archive_path, copy_stream
from .zip_probe import prefixed_zip

MAX_DEPTH = 3


def identify(path):
    with path.open("rb") as stream:
        header = stream.read(512)
    for magic, kind in [
        (b"PK\x03\x04", "zip"),
        (b"PK\x05\x06", "zip"),
        (b"PK\x07\x08", "zip"),
        (b"\x1f\x8b", "gzip"),
        (b"BZh", "bzip2"),
        (b"\xfd7zXZ\x00", "xz"),
        (b"\x28\xb5\x2f\xfd", "zstd"),
    ]:
        if header.startswith(magic):
            return kind
    if len(header) >= 4 and 0x50 <= header[0] <= 0x5F and header[1:4] == b"\x2a\x4d\x18":
        raise ScanError("unsupported-zstd-skippable-frame")
    if header.startswith((b"Rar!\x1a\x07", b"7z\xbc\xaf\x27\x1c", b"!<arch>\n")):
        raise ScanError("unsupported-nested-container")
    if header[257:262] == b"ustar":
        return "tar"
    # Legacy tar has no magic string; its 512-byte header checksum is authoritative.
    if len(header) == 512:
        if header == bytes(512):
            return "tar"
        try:
            tarfile.TarInfo.frombuf(header, "utf-8", "surrogateescape")
        except tarfile.HeaderError:
            pass
        else:
            return "tar"
    # Include self-extracting/prefixed ZIPs whose central directory identifies the format.
    if prefixed_zip(path):
        return "zip"
    return None


def child_location(parent, index, path):
    return dict(
        parent,
        path=parent["path"] + "!" + path,
        member=(parent.get("member", "") + "/" + str(index)).lstrip("/"),
    )


def inspect_nested(stage, physical, location, depth):
    kind = identify(physical)
    if kind is None:
        return
    if depth >= MAX_DEPTH:
        raise ScanError("nested-archive-depth-limit")
    try:
        decode_nested(stage, physical, location, depth, kind)
    except (
        OSError,
        EOFError,
        ValueError,
        NotImplementedError,
        zipfile.BadZipFile,
        tarfile.TarError,
        lzma.LZMAError,
    ) as error:
        # Decoder messages can contain private names/bytes; expose only the format.
        raise ScanError("nested-" + kind + "-decode-failed") from error


def decode_nested(stage, physical, location, depth, kind):
    if kind == "zip":
        with zipfile.ZipFile(physical) as archive:
            for index, member in enumerate(archive.infolist()):
                stage.budget.entry()
                name = archive_path(member.filename)
                child = child_location(location, index, name)
                if member.flag_bits & 1:
                    raise ScanError("encrypted-nested-archive")
                stage.add(json.dumps({"path": name}).encode(), child)
                if member.is_dir():
                    stage.inspect_path(child, name)
                else:
                    with archive.open(member) as stream:
                        stage.file(stream, member.file_size, child, name, depth + 1)
    elif kind == "tar":
        with tarfile.open(physical, "r:") as archive:
            for index, member in enumerate(archive):
                stage.budget.entry()
                name = archive_path(member.name)
                child = child_location(location, index, name)
                if member.issparse():
                    raise ScanError("sparse-nested-archive")
                stage.add(
                    json.dumps({"path": name, "link": member.linkname, "pax": member.pax_headers}).encode(),
                    child,
                )
                if member.isfile():
                    with archive.extractfile(member) as stream:
                        stage.file(stream, member.size, child, name, depth + 1)
                elif member.isdir() or member.issym() or member.islnk() or member.isdev():
                    stage.inspect_path(child, name)
                else:
                    raise ScanError("unsupported-nested-entry")
    else:
        unpacked = physical.with_suffix(".decoded")
        try:
            remaining = stage.budget.max_bytes - stage.budget.bytes
            if kind == "zstd":
                decode_zstd(physical, unpacked, remaining, stage.backend.timeout)
            else:
                opener = {"gzip": gzip.open, "bzip2": bz2.open, "xz": lzma.open}[kind]
                with opener(physical, "rb") as stream:
                    copy_stream(stream, unpacked, remaining)
            stage.budget.entry()
            child = child_location(location, 0, "decoded")
            with unpacked.open("rb") as stream:
                stage.file(stream, unpacked.stat().st_size, child, None, depth + 1)
        finally:
            unpacked.unlink(missing_ok=True)


def decode_zstd(source, destination, limit, timeout):
    try:
        proc = subprocess.Popen(
            ["zstd", "-d", "-q", "-c", str(source)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
    except OSError as error:
        raise ScanError("zstd-unavailable") from error
    timer = threading.Timer(timeout, proc.kill)
    timer.start()
    try:
        copy_stream(proc.stdout, destination, limit)
        if proc.wait(timeout=timeout) != 0:
            raise ScanError("zstd-decompression-failed")
    finally:
        timer.cancel()
        timer.join()
        proc.stdout.close()
        if proc.poll() is None:
            proc.kill()
        proc.wait()
