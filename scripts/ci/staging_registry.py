"""Registry transport kept separate from the exact-artifact publication decision."""

import hashlib
import json
import re
import subprocess

from staging_image import require
from staging_oci import verify_layout
from staging_registry_history import history_hash, verify_history


def missing_manifest(stderr, target):
    # Only an explicit manifest-unknown response for this exact tag permits a push.
    # Authentication, network, throttling, and parsing failures are never absence.
    package, tag = target.rsplit(":", 1)
    repository = package.removeprefix("ghcr.io/")
    suffix = f"GET https://ghcr.io/v2/{repository}/manifests/{tag}: MANIFEST_UNKNOWN: manifest unknown"
    # Numeric substrings in a SHA are not HTTP status codes. Match crane's full
    # known error grammar instead of interpreting arbitrary prefixes as absence.
    return stderr.strip() in (
        suffix, "Error: " + suffix, f"Error: fetching manifest {target}: " + suffix,
    )


class RegistryOperationError(ValueError):
    """Only allowlisted diagnostics cross into public logs; never remote text."""

    def __init__(self, operation, stderr):
        operation = operation if operation in {"push", "pull", "manifest", "digest"} else "operation"
        diagnostic = stderr.decode("utf-8", errors="replace")
        status = re.search(r"(?:unexpected status(?: code)?|response status|:)\s+(4[0-9]{2}|5[0-9]{2})\b",
                           diagnostic, re.IGNORECASE)
        code = status[1] if status else "unknown"
        patterns = [
            ("authorization", r"\b(?:UNAUTHORIZED|DENIED|permission_denied|write_package)\b"),
            ("rate_limit", r"\b(?:TOOMANYREQUESTS|rate.limit)\b"),
            ("invalid_content", r"\b(?:MANIFEST_INVALID|BLOB_UNKNOWN|DIGEST_INVALID|NAME_INVALID|SIZE_INVALID|UNSUPPORTED)\b"),
            ("tls", r"\b(?:x509|TLS|certificate)\b"),
            ("network", r"\b(?:timeout|timed out|connection refused|no such host|connection reset)\b"),
            ("local_layout", r"(?:loading .* as OCI layout|layout contains|no such file or directory)"),
        ]
        category = next((name for name, pattern in patterns if re.search(pattern, diagnostic, re.IGNORECASE)), "unclassified")
        super().__init__(f"Registry {operation} failed; category={category}; http_status={code}; raw output withheld")


class CraneRegistry:
    def __init__(self, command="crane", run=subprocess.run):
        self.command = command
        self.run = run

    def invoke(self, args, allow_missing=None):
        result = self.run([self.command, *args], capture_output=True, check=False, timeout=900)
        if result.returncode:
            if allow_missing and missing_manifest(result.stderr.decode(), allow_missing):
                return None
            raise RegistryOperationError(args[0], result.stderr)
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


def publish_exact(registry, target, layout, pulled, manifest, digest, metadata, *, history,
                  observations=None):
    # Every path, including an idempotent retry, first verifies the scanned graph.
    verify_layout(layout, manifest, digest, metadata)
    try:
        existing = registry.lookup(target)
        require(existing is None or existing == (digest, manifest),
                "Source tag collision; refusing publication")
        before = history.snapshot(target)
        # This is the last remote operation before push. GHCR has no atomic
        # create-only tag write: another writer can still race until crane finishes
        # uploading blobs and assigning the tag, which may take substantial time.
        current = registry.lookup(target)
        require(current is None or current == (digest, manifest),
                "Source tag appeared or changed before push; refusing publication")
        require(existing is None or current is not None, "Source tag disappeared before reuse")
        if current is None:
            tag = target.rsplit(":", 1)[1]
            require(all(tag not in version["tags"] for version in before.values()),
                    "Package history already assigns source tag; refusing publication")
            action = "published"
            require(registry.push(layout, target) == digest, "Push changed the scanned manifest")
        else:
            action = "reused"
        require(registry.lookup(target) == (digest, manifest),
                "Registry tag differs from scanned image after publication")
        after = history.snapshot(target)
        verify_history(before, after, target, digest, action)
        registry.verify(target.rsplit(":", 1)[0] + "@" + digest, pulled, manifest, digest, metadata)
        # A full pull may take time: check identity and version metadata again
        # immediately before allowing the unchanged receipt generator to run.
        require(registry.lookup(target) == (digest, manifest),
                "Registry tag changed during final blob verification")
        final = history.snapshot(target)
        verify_history(before, final, target, digest, action)
        require(after == final, "Package history changed during final verification")
        if observations is not None:
            observations.update(historyBeforeSha256=history_hash(before),
                                historyAfterSha256=history_hash(final),
                                historyIsCompleteAuditLog=False,
                                atomicCreateOnlySupported=False)
        return action
    except RegistryOperationError as error:
        # A nonzero crane exit is not evidence of a competing package writer.
        print("::error title=Ornn registry operation failed::" + str(error), flush=True)
        raise
    except (ValueError, OSError, subprocess.SubprocessError):
        print("::error title=Ornn publication safety check failed::Publication validation failed. "
              "Identity, tag or package-history evidence did not verify. "
              "do not deploy from this job. Investigate before retrying.", flush=True)
        raise
