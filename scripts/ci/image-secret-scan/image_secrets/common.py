"""Small shared contracts; error messages are identifiers, never input content."""

import hashlib
import json
from pathlib import PurePosixPath


class ScanError(Exception):
    """A safe, fixed error identifier suitable for a public report."""


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def archive_path(name):
    if not isinstance(name, str) or "\x00" in name or "\\" in name:
        raise ScanError("unsafe-archive-path")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise ScanError("unsafe-archive-path")
    return str(path)


def json_bytes(data):
    # Duplicate JSON keys make descriptor/config interpretation ambiguous.
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ScanError("duplicate-json-key")
            result[key] = value
        return result

    def invalid_constant(value):
        raise ScanError("nonstandard-json-constant")

    try:
        return json.loads(data, object_pairs_hook=pairs, parse_constant=invalid_constant)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise ScanError("invalid-json") from error


def write_json(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=True)
        stream.write("\n")


class Budget:
    """A hard cap fails the scan rather than silently omitting large entries."""

    def __init__(self, max_bytes, max_entries):
        self.max_bytes = max_bytes
        self.max_entries = max_entries
        self.bytes = 0
        self.entries = 0

    def entry(self):
        self.entries += 1
        if self.entries > self.max_entries:
            raise ScanError("entry-budget-exceeded")

    def reserve(self, count):
        if count < 0 or self.bytes + count > self.max_bytes:
            raise ScanError("byte-budget-exceeded")
        self.bytes += count


def copy_stream(source, destination, limit):
    total = 0
    with destination.open("xb") as output:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            total += len(block)
            if total > limit:
                raise ScanError("expanded-layer-budget-exceeded")
            output.write(block)
    return total
