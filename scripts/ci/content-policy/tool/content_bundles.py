"""Narrow reviewed-value scopes for content-hashed Vite JavaScript outputs."""
import hashlib
import re

from image_secrets.common import ScanError
from image_secrets.gate import valid_digest

PREFIX = "usr/share/nginx/html/assets/"
STEM = r"[A-Za-z][A-Za-z0-9_-]{0,127}"
OUTPUT = re.compile(re.escape(PREFIX) + r"(" + STEM + r")-[A-Za-z0-9_-]{8}\.js")
PATTERN = re.compile(re.escape(PREFIX) + STEM + r"-\*\.js")
RULE = "gitleaks.image-secret-assignment"


def pattern_identity(pattern):
    return hashlib.sha256(pattern.encode()).hexdigest()


def normalized_scope(path):
    match = OUTPUT.fullmatch(path)
    return pattern_identity(PREFIX + match[1] + "-*.js") if match else None


def catalog_entries(catalog):
    entries = catalog.get("bundle_candidates", [])
    if not isinstance(entries, list) or len(entries) > 64:
        raise ScanError("invalid-bundle-candidate-entries")
    keys = set()
    fields = {"component", "path_pattern", "rule", "candidate_sha256", "classification", "reason"}
    for entry in entries:
        if (not isinstance(entry, dict) or set(entry) != fields or entry["component"] != "web"
                or not isinstance(entry["path_pattern"], str) or not PATTERN.fullmatch(entry["path_pattern"])
                or entry["rule"] != RULE or not valid_digest(entry["candidate_sha256"])
                or entry["classification"] != "public-material"
                or not isinstance(entry["reason"], str) or not entry["reason"].strip()):
            raise ScanError("invalid-bundle-candidate-entry")
        key = ("bundle", "web", pattern_identity(entry["path_pattern"]), RULE, entry["candidate_sha256"])
        if key in keys:
            raise ScanError("duplicate-bundle-candidate-entry")
        keys.add(key)
        yield key, entry
