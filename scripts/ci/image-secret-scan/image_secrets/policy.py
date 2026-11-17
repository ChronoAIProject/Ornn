"""Detection policy and narrow reviewed exceptions, independent of archive traversal."""

import re
from pathlib import PurePosixPath

from .common import ScanError, digest_bytes, digest_file, json_bytes

PRIVATE = re.compile(rb"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")
SERVICE_ACCOUNT = re.compile(rb'"type"\s*:\s*"service_account"')
CREDENTIAL_URL = re.compile(rb"[a-zA-Z][a-zA-Z0-9+.-]*://[^\s/:@]+:([^\s/@]+)@")
CONFIG_SECRET = re.compile(
    rb"(?i)(?:^|[\s\"'])(?:--)?((?:[A-Z0-9]+[_-])*(?:password|passwd|secret|"
    rb"(?:api|access|auth|bearer|refresh|session|private|client)[_-]?(?:key|token|secret)|"
    rb"credentials?))(?:[\"'])?(?:\s*[:=]\s*|\s+)[\"']?([^\s\"']+)"
)


def path_rule(name):
    path = PurePosixPath(name.lower())
    base, parts = path.name, path.parts
    if ".git" in parts:
        return "path.git-metadata"
    if base.startswith(".env"):
        return "path.env-file"
    if base.startswith(("id_rsa", "id_dsa", "id_ecdsa", "id_ed25519")):
        return "path.ssh-key"
    if base.endswith((".pem", ".key", ".p12", ".pfx")):
        return "path.key-or-certificate"
    if base in (".npmrc", ".pypirc", ".netrc", ".git-credentials"):
        return "path.auth-config"
    if base in (
        "kubeconfig",
        "kubeconfig.yaml",
        "kubeconfig.yml",
        "credentials.json",
        "service-account.json",
        "service_account.json",
        "application_default_credentials.json",
    ):
        return "path.credential-file"
    if ".docker" in parts and base == "config.json":
        return "path.docker-auth"
    if ".kube" in parts and base == "config":
        return "path.kubeconfig"
    if ".aws" in parts and (base in ("credentials", "config") or "cache" in parts):
        return "path.aws-credentials"
    if ".azure" in parts and (base.endswith((".json", ".bin")) or "token" in base or "credential" in base):
        return "path.azure-credentials"
    if "gcloud" in parts and ("credential" in base or base.endswith(".db") or "legacy_credentials" in parts):
        return "path.gcp-credentials"
    if ".cargo" in parts and base in ("credentials", "credentials.toml"):
        return "path.cargo-credentials"
    return None


class Allowlist:
    """Each exception binds one rule, one exact logical path and exact value bytes."""

    def __init__(self, path):
        self.entries = []
        data = json_bytes(path.read_bytes())
        if (
            not isinstance(data, dict)
            or data.get("version") != 1
            or not isinstance(data.get("entries"), list)
        ):
            raise ScanError("invalid-allowlist")
        ids = set()
        for entry in data["entries"]:
            fields = {"id", "rule", "scope", "path", "reason"}
            if (
                not isinstance(entry, dict)
                or set(entry) not in (fields | {"match_sha256"}, fields | {"file_sha256"})
                or not all(isinstance(v, str) for v in entry.values())
            ):
                raise ScanError("invalid-allowlist-entry")
            checksum = entry.get("match_sha256", entry.get("file_sha256"))
            if (
                not re.fullmatch(r"[a-z0-9-]{1,80}", entry["id"])
                or entry["id"] in ids
                or not re.fullmatch(r"[a-f0-9]{64}", checksum)
                or not entry["reason"].strip()
                or entry["scope"] not in ("layer", "config", "archive")
                or not entry["path"]
                or any(c in entry["path"] for c in "*?[]")
            ):
                raise ScanError("invalid-allowlist-entry")
            if (
                "private-key" in entry["rule"]
                or "service-account" in entry["rule"]
                or entry["rule"]
                in (
                    "content.private-key-header",
                    "content.service-account",
                    "content.credential-url",
                    "config.secret-assignment",
                )
            ):
                raise ScanError("non-allowlistable-rule")
            ids.add(entry["id"])
            self.entries.append(entry)

    def match(self, rule, location, value_digest, file_digest=None):
        for entry in self.entries:
            checksum_matches = (
                entry.get("match_sha256") == value_digest
                if "match_sha256" in entry
                else entry["file_sha256"] == file_digest
            )
            if (
                entry["rule"] == rule
                and entry["scope"] == location["scope"]
                and entry["path"] == location["path"]
                and checksum_matches
            ):
                return entry
        return None


class Findings:
    def __init__(self, allowlist):
        self.allowlist = allowlist
        self.items = []
        self.allowed = []
        self.seen = set()

    def add(self, rule, location, value_digest=None, line=None, file_digest=None):
        item = dict(location, rule=rule)
        if file_digest:
            item["file_sha256"] = file_digest
        if line is not None:
            item["line"] = line
        # Two different values can share one line/rule. An allowed public value must
        # never suppress a second credential through deduplication.
        key = (rule, tuple(sorted(location.items())), line, value_digest, file_digest)
        if key in self.seen:
            return
        self.seen.add(key)
        exception = (
            self.allowlist.match(rule, location, value_digest, file_digest)
            if value_digest or file_digest
            else None
        )
        if exception:
            self.allowed.append(dict(item, allowlist_id=exception["id"]))
        else:
            self.items.append(item)

    def inspect(self, path, location, original_path=None):
        if original_path is not None:
            rule = path_rule(original_path)
            if rule:
                checksum = digest_file(path)
                self.add(rule, location, checksum, file_digest=checksum)
        tail = b""
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                data = tail + block
                if PRIVATE.search(data):
                    self.add("content.private-key-header", location)
                if SERVICE_ACCOUNT.search(data):
                    self.add("content.service-account", location)
                if CREDENTIAL_URL.search(data):
                    self.add("content.credential-url", location)
                if location["scope"] == "config" and CONFIG_SECRET.search(data):
                    self.add("config.secret-assignment", location)
                tail = data[-8192:]

    def safe_items(self, items):
        # Filename confidentiality must not depend on a completed detector run.
        # Numeric locators plus an opaque path digest remain useful even on partial errors.
        output = []
        for original in items:
            item = original.copy()
            checksum = digest_bytes(item["path"].encode("utf-8", "surrogatepass"))
            item["path"] = "path-sha256:" + checksum
            output.append(item)
        return output
