"""Reviewed exceptions to generic heuristics; credential-specific rules stay strict."""

import fnmatch
import re

from .common import ScanError, json_bytes

# An explicit set also prevents newly added provider rules becoming allowlistable
# by default. Generic API-key false positives still require exact path and bytes.
EXACT_RULES = frozenset(
    {"gitleaks.image-high-entropy", "gitleaks.generic-api-key", "path.key-or-certificate"}
)
GLOB_RULES = frozenset({"gitleaks.image-high-entropy"})


def valid_glob(pattern):
    parts = pattern.split("/")
    return (
        len(parts) >= 3
        and all(part not in ("", ".", "..") for part in parts)
        and not any(c in pattern for c in "!\\\x00\n\r[]")
        and "**" not in pattern
        and all(not any(c in part for c in "*?") for part in parts[:-1])
        and any(c in parts[-1] for c in "*?")
        and "." in parts[-1]
    )


class Allowlist:
    """Exact-value/file entries, or reviewed file-pinned leaf globs for entropy only."""

    def __init__(self, path):
        self.entries = []
        data = json_bytes(path.read_bytes())
        if (
            not isinstance(data, dict)
            or set(data) != {"version", "entries"}
            or type(data["version"]) is not int
            or data["version"] not in (1, 2)
            or not isinstance(data["entries"], list)
        ):
            raise ScanError("invalid-allowlist")
        ids = set()
        for entry in data["entries"]:
            self.validate(entry, data["version"], ids)
            ids.add(entry["id"])
            self.entries.append(entry)

    @staticmethod
    def validate(entry, version, ids):
        if not isinstance(entry, dict) or not all(isinstance(v, str) for v in entry.values()):
            raise ScanError("invalid-allowlist-entry")
        fields = {"id", "rule", "scope", "path", "reason"}
        exact = set(entry) in (fields | {"match_sha256"}, fields | {"file_sha256"})
        glob_fields = (fields - {"path"}) | {"path_glob", "file_sha256", "review"}
        glob = version == 2 and set(entry) == glob_fields
        if not (exact or glob):
            raise ScanError("invalid-allowlist-entry")
        checksum = entry.get("match_sha256", entry.get("file_sha256"))
        if (
            not re.fullmatch(r"[a-z0-9-]{1,80}", entry["id"])
            or entry["id"] in ids
            or not re.fullmatch(r"[a-f0-9]{64}", checksum)
            or not entry["reason"].strip()
            or entry["scope"] not in ("layer", "config", "archive")
        ):
            raise ScanError("invalid-allowlist-entry")
        if entry["rule"] not in (GLOB_RULES if glob else EXACT_RULES):
            raise ScanError("non-allowlistable-rule")
        if exact and (not entry["path"] or any(c in entry["path"] for c in "*?[]")):
            raise ScanError("invalid-allowlist-entry")
        if glob and (
            entry["scope"] != "layer" or not valid_glob(entry["path_glob"]) or not entry["review"].strip()
        ):
            raise ScanError("invalid-reviewed-glob")

    def match(self, rule, location, value_digest, file_digest=None):
        for entry in self.entries:
            if entry["rule"] != rule or entry["scope"] != location["scope"]:
                continue
            if "path_glob" in entry:
                # Match leaf names only; '*' cannot cross directories or containers.
                pattern, path = entry["path_glob"].rsplit("/", 1), location["path"].rsplit("/", 1)
                path_matches = (
                    len(path) == 2
                    and "!" not in location["path"]
                    and path[0] == pattern[0]
                    and fnmatch.fnmatchcase(path[1], pattern[1])
                )
            else:
                path_matches = entry["path"] == location["path"]
            checksum_matches = (
                entry["match_sha256"] == value_digest
                if "match_sha256" in entry
                else entry["file_sha256"] == file_digest
            )
            if path_matches and checksum_matches:
                return entry
        return None
