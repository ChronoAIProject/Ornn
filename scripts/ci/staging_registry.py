"""Registry transport kept separate from the exact-artifact publication decision."""

import hashlib
import json
import re
import subprocess

from staging_image import require
from staging_oci import verify_layout


def missing_manifest(stderr, target):
    # Only an explicit manifest-unknown response for this exact tag permits a push.
    # Authentication, network, throttling, and parsing failures are never absence.
    package, tag = target.rsplit(":", 1)
    repository = package.removeprefix("ghcr.io/")
    suffix = f"GET https://ghcr.io/v2/{repository}/manifests/{tag}: MANIFEST_UNKNOWN: manifest unknown"
    line = stderr.strip()
    return line.endswith(suffix) and "\n" not in line and not re.search(
        r"(?i)unauthorized|denied|forbidden|timeout|429|5[0-9]{2}|401|403", line.removesuffix(suffix))


class CraneRegistry:
    def __init__(self, command="crane", run=subprocess.run):
        self.command = command
        self.run = run

    def invoke(self, args, allow_missing=None):
        result = self.run([self.command, *args], capture_output=True, check=False, timeout=900)
        if result.returncode:
            if allow_missing and missing_manifest(result.stderr.decode(), allow_missing):
                return None
            raise ValueError("Registry operation failed; raw output withheld")
        return result.stdout

    def lookup(self, target):
        raw = self.invoke(["manifest", target], allow_missing=target)
        if raw is None:
            return None
        digest = self.invoke(["digest", target]).decode().strip()
        require(re.fullmatch(r"sha256:[a-f0-9]{64}", digest), "Invalid registry digest")
        # crane appends a newline; prove exact manifest bytes using its digest.
        candidates = (raw, raw[:-1] if raw.endswith(b"\n") else raw)
        require(any("sha256:" + hashlib.sha256(data).hexdigest() == digest for data in candidates),
                "Tag changed while reading registry manifest")
        return digest, json.loads(raw)

    def push(self, layout, target):
        reference = self.invoke(["push", str(layout), target]).decode().strip()
        require(reference.startswith(target.rsplit(":", 1)[0] + "@sha256:"),
                "Unexpected pushed reference")
        return reference.rsplit("@", 1)[1]

    def verify(self, reference, output, manifest, digest, metadata):
        self.invoke(["pull", reference, str(output), "--format=oci"])
        verify_layout(output, manifest, digest, metadata)


def publish_exact(registry, target, layout, pulled, manifest, digest, metadata):
    # Every path, including an idempotent retry, first verifies the scanned graph.
    verify_layout(layout, manifest, digest, metadata)
    existing = registry.lookup(target)
    if existing is None:
        action = "published"
        require(registry.push(layout, target) == digest, "Push changed the scanned manifest")
    else:
        action = "reused"
        require(existing == (digest, manifest), "Source tag collision; refusing to overwrite")
    require(registry.lookup(target) == (digest, manifest), "Registry tag differs from scanned image")
    registry.verify(target.rsplit(":", 1)[0] + "@" + digest, pulled, manifest, digest, metadata)
    return action
