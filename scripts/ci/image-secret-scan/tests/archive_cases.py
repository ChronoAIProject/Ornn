"""Synthetic malformed archives; no retained binary or credential fixtures."""

import io
import struct
import zipfile
import zlib


def packed_zip(payload, method=zipfile.ZIP_DEFLATED, zip64=False, descriptor=False):
    class Unseekable(io.BytesIO):
        def seekable(self):
            return False

        def seek(self, *args):
            raise OSError("synthetic streaming output")

    output = Unseekable() if descriptor else io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=method) as archive:
        with archive.open("member.txt", "w", force_zip64=zip64) as stream:
            stream.write(payload)
    data = bytearray(output.getvalue())
    if zip64:
        # Python 3.9 may rewrite small seekable members with 32-bit sizes while
        # retaining the ZIP64 extra. Exercise actual sentinel resolution too.
        struct.pack_into("<H", data, 4, 45)
        struct.pack_into("<LL", data, 18, 0xffffffff, 0xffffffff)
    return bytes(data)


def forged_zip(payload, size, crc=None, method=zipfile.ZIP_DEFLATED):
    data = bytearray(packed_zip(payload, method))
    central = data.index(b"PK\x01\x02")
    for offset in (22, central + 24):
        struct.pack_into("<L", data, offset, size)
    if crc is not None:
        for offset in (14, central + 16):
            struct.pack_into("<L", data, offset, crc)
    return bytes(data)


def resized_compressed_extent(payload, suffix=b"unexplained", remove=0, method=zipfile.ZIP_DEFLATED):
    data = bytearray(packed_zip(payload, method))
    central = data.index(b"PK\x01\x02")
    delta = len(suffix) - remove
    size, = struct.unpack_from("<L", data, 18)
    data[central - remove:central] = suffix
    central += delta
    struct.pack_into("<L", data, 18, size + delta)
    struct.pack_into("<L", data, central + 20, size + delta)
    struct.pack_into("<L", data, len(data) - 6, central)
    return bytes(data)


def prefix_crc():
    return zlib.crc32(b"A")
