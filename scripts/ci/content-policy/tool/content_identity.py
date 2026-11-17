"""Read-only per-layer file identities; never extract image-controlled paths."""

import hashlib
import json
import posixpath
import tarfile

from content_catalog import path_hash
from image_secrets.archive import ImageArchive
from image_secrets.common import Budget, ScanError, archive_path
from image_secrets.policy import CREDENTIAL_URL, PRIVATE, SERVICE_ACCOUNT


def target_path(path, target, hard=False):
    if "\x00" in target or "\\" in target:
        raise ScanError("invalid-content-link")
    raw = (
        target
        if hard or target.startswith("/")
        else posixpath.join(posixpath.dirname(path), target)
    )
    return posixpath.normpath("/" + raw.lstrip("/")).lstrip("/")


def resolve(state, path, active=None):
    active = set() if active is None else active
    if path in active or len(active) > 64:
        return None
    active.add(path)
    parts = path.split("/")
    # Resolve directory symlinks inside the virtual image, never the host filesystem.
    for n in range(1, len(parts)):
        prefix = "/".join(parts[:n])
        node = state.get(prefix)
        if node and node[0] == "link":
            return resolve(state, posixpath.join(node[1], *parts[n:]), active)
    node = state.get(path)
    if not node:
        return None
    if node[0] == "file":
        return node[1]
    if node[0] == "link":
        return resolve(state, node[1], active)
    return None


def layer_identities(layer_path, state, requested):
    records, updates, removed, opaque = {}, {}, [], []
    with tarfile.open(layer_path, "r:") as layer:
        for number, member in enumerate(layer):
            path = archive_path(member.name)
            base, parent = posixpath.basename(path), posixpath.dirname(path)
            if member.issparse():
                raise ScanError("sparse-content-entry")
            if base == ".wh..wh..opq":
                opaque.append(parent)
                continue
            if base.startswith(".wh."):
                removed.append(posixpath.join(parent, base[4:]))
                continue
            if member.isfile():
                digest = hashlib.sha256()
                with layer.extractfile(member) as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(block)
                node = ("file", digest.hexdigest())
            elif member.issym():
                node = ("link", target_path(path, member.linkname))
            elif member.islnk():
                # Hard-link inode lifetimes differ from symbolic links. Leave these
                # unclassified rather than infer content after a later replacement.
                node = ("other", None)
            else:
                node = ("other", None)
            updates[path] = node
            if number in requested:
                metadata = json.dumps(
                    {"path": path, "link": member.linkname, "pax": member.pax_headers},
                    ensure_ascii=False,
                ).encode()
                metadata_rules = {
                    rule
                    for rule, pattern in (
                        ("content.credential-url", CREDENTIAL_URL),
                        ("content.private-key-header", PRIVATE),
                        ("content.service-account", SERVICE_ACCOUNT),
                    )
                    if pattern.search(metadata)
                }
                records[number] = (path, node, metadata_rules)
    for path in list(state):
        if any(path == p or path.startswith(p + "/") for p in removed) or any(
            not p or path.startswith(p + "/") for p in opaque
        ):
            del state[path]
    # Replacing a directory with a non-directory cannot retain its former children.
    for child in list(state):
        parts = child.split("/")
        if any(
            updates.get("/".join(parts[:n]), ("other",))[0] != "other"
            for n in range(1, len(parts))
        ):
            del state[child]
    state.update(updates)
    result = {}
    for number, (path, node, metadata_rules) in records.items():
        # Duplicate tar entries retain their own bytes, even if overwritten later.
        digest = (
            node[1]
            if node[0] == "file"
            else resolve(state, node[1])
            if node[0] == "link"
            else None
        )
        for finding in requested[number]:
            # Targeted findings do not distinguish tar metadata from file payload.
            # Public payload identity cannot approve a new credential in a PAX field.
            if finding["rule"] in metadata_rules:
                continue
            if finding["path"] != path_hash(path):
                # Nested/config metadata occurrences need separate explicit approval.
                continue
            if finding.get("file_sha256", digest) != digest:
                continue
            if digest:
                result[finding["finding_id"]] = digest
    return result


def archive_identities(path, workspace, report):
    budget = Budget(20 * 1024**3, 1000000)
    found = {}
    with ImageArchive(path, workspace, budget) as archive:
        _, images = archive.images()
        expected = report["inventory"]["images"]
        if len(images) != len(expected):
            raise ScanError("content-image-count-mismatch")
        for i, image in enumerate(images):
            if image["config_digest"] != expected[i]["config_digest"]:
                raise ScanError("content-config-mismatch")
            state = {}
            for j, (name, diff_id) in enumerate(
                zip(image["layers"], image["diff_ids"])
            ):
                requested = {}
                for finding in report["findings"]:
                    if (
                        finding["scope"] == "layer"
                        and finding["image"] == i
                        and finding["layer"] == j
                        and finding["rule"] != "gitleaks.image-high-entropy"
                    ):
                        requested.setdefault(finding["entry"], []).append(finding)
                layer_path = archive.layer(name, diff_id)
                found.update(layer_identities(layer_path, state, requested))
                layer_path.unlink()
    return found
