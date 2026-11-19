"""Validate archive framing independently of readers that tolerate early EOF."""

import bz2
import lzma
import struct
import zipfile
import zlib
from contextlib import contextmanager

from .common import ScanError

CHUNK = 1024 * 1024


def tar_trailer(archive, limit):
    # TarFile.offset remains at the first unparsed header, including a zero
    # block or a malformed header that TarFile.next silently treats as EOF.
    stream = archive.fileobj
    stream.seek(archive.offset)
    if stream.read(1024) != bytes(1024):
        raise ScanError("tar-end-blocks-invalid")
    total = 1024
    while True:
        block = stream.read(min(CHUNK, max(1, limit - total + 1)))
        if not block:
            return
        total += len(block)
        if total > limit:
            raise ScanError("tar-padding-budget-exceeded")
        if block.strip(b"\0"):
            raise ScanError("tar-nonzero-trailer")


def zip_boundaries(archive):
    offsets = sorted(member.header_offset for member in archive.infolist())
    if len(offsets) != len(set(offsets)):
        raise ScanError("zip-overlapping-members")
    return dict(zip(offsets, offsets[1:] + [archive.start_dir]))


def zip_extent(stream, member, boundary):
    stream.seek(member.header_offset)
    header = stream.read(30)
    if len(header) != 30:
        raise ScanError("zip-local-header-invalid")
    signature, _, flags, method, _, _, crc, packed, size, names, extras = struct.unpack("<4s5H3L2H", header)
    if signature != b"PK\x03\x04" or flags != member.flag_bits or method != member.compress_type:
        raise ScanError("zip-local-header-mismatch")
    stream.seek(names, 1)
    extra = stream.read(extras)
    if len(extra) != extras:
        raise ScanError("zip-local-header-invalid")
    if size == 0xffffffff or packed == 0xffffffff:
        cursor = 0
        while cursor + 4 <= len(extra):
            kind, length = struct.unpack_from("<HH", extra, cursor)
            cursor += 4
            if cursor + length > len(extra):
                raise ScanError("zip-local-header-invalid")
            if kind == 1:
                values = extra[cursor:cursor + length]
                for field in ("size", "packed"):
                    if (size if field == "size" else packed) == 0xffffffff:
                        if len(values) < 8:
                            raise ScanError("zip-local-header-invalid")
                        value, = struct.unpack_from("<Q", values)
                        values = values[8:]
                        if field == "size":
                            size = value
                        else:
                            packed = value
                break
            cursor += length
    if not flags & 8 and (crc, packed, size) != (member.CRC, member.compress_size, member.file_size):
        raise ScanError("zip-local-header-mismatch")
    start = stream.tell()
    end = start + member.compress_size
    if end > boundary:
        raise ScanError("zip-compressed-extent-invalid")
    if flags & 8:
        if boundary - end not in (12, 16, 20, 24):
            raise ScanError("zip-data-descriptor-invalid")
        stream.seek(end)
        descriptor = stream.read(boundary - end)
        if len(descriptor) in (16, 24):
            if descriptor[:4] != b"PK\x07\x08":
                raise ScanError("zip-data-descriptor-invalid")
            descriptor = descriptor[4:]
        values = struct.unpack("<3L" if len(descriptor) == 12 else "<L2Q", descriptor)
        if values != (member.CRC, member.compress_size, member.file_size):
            raise ScanError("zip-data-descriptor-mismatch")
    elif end != boundary:
        raise ScanError("zip-unexplained-member-data")
    stream.seek(start)


def zip_decode(stream, member, destination, limit):
    remaining = member.compress_size
    method = member.compress_type
    prefix = b""
    if method == zipfile.ZIP_STORED:
        decoder = None
    elif method == zipfile.ZIP_DEFLATED:
        decoder = zlib.decompressobj(-15)
    elif method == zipfile.ZIP_BZIP2:
        decoder = bz2.BZ2Decompressor()
    elif method == zipfile.ZIP_LZMA:
        header = stream.read(min(remaining, 9))
        remaining -= len(header)
        if len(header) != 9 or header[2:4] != b"\x05\x00":
            raise ScanError("zip-lzma-header-invalid")
        # ZIP stores LZMA1 properties separately. The standard ALONE decoder
        # accepts those properties with an unknown-size header and enforces EOF.
        prefix = header[4:] + b"\xff" * 8
        decoder = lzma.LZMADecompressor(lzma.FORMAT_ALONE, memlimit=256 * 1024 * 1024)
    else:
        raise ScanError("unsupported-zip-compression")
    total = crc = 0
    with destination.open("xb") as output:
        while remaining or prefix:
            data = prefix or stream.read(min(CHUNK, remaining))
            if not data:
                raise ScanError("zip-compressed-stream-truncated")
            if prefix:
                prefix = b""
            else:
                remaining -= len(data)
            while True:
                cap = min(CHUNK, min(limit, member.file_size) - total + 1)
                decoded = decoder.decompress(data, max_length=cap) if decoder else data
                total += len(decoded)
                if total > limit:
                    raise ScanError("expanded-layer-budget-exceeded")
                if total > member.file_size:
                    raise ScanError("zip-decoded-size-mismatch")
                output.write(decoded)
                crc = zlib.crc32(decoded, crc)
                if decoder is None:
                    break
                if decoder.eof:
                    if decoder.unused_data or remaining:
                        raise ScanError("zip-trailing-compressed-data")
                    break
                if method == zipfile.ZIP_DEFLATED:
                    data = decoder.unconsumed_tail
                    if not data and len(decoded) < cap:
                        break
                else:
                    data = b""
                    if decoder.needs_input:
                        break
        if decoder is not None and not decoder.eof:
            raise ScanError("zip-compressed-stream-truncated")
        if total != member.file_size:
            raise ScanError("zip-decoded-size-mismatch")
        if crc != member.CRC:
            raise ScanError("zip-decoded-crc-mismatch")


@contextmanager
def verified_zip_member(physical, archive, member, boundary, limit):
    if member.file_size > limit:
        raise ScanError("expanded-layer-budget-exceeded")
    destination = physical.with_suffix(".zip-decoded")
    try:
        # Preserve zipfile's filename, encryption and overlap validation, but
        # never use its size-clipped output as evidence of complete decoding.
        with archive.open(member), physical.open("rb") as stream:
            zip_extent(stream, member, boundary)
            try:
                zip_decode(stream, member, destination, limit)
            except (zlib.error, OSError, EOFError, lzma.LZMAError) as error:
                raise ScanError("zip-compressed-stream-invalid") from error
        with destination.open("rb") as stream:
            yield stream
    finally:
        destination.unlink(missing_ok=True)
