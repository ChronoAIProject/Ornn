"""Version the SPA by its build inputs while retaining commit provenance separately."""

import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
LABEL = "io.chronoai.ornn.web-build-identity"
SCHEMA = "ornn-web-build-inputs-v1"
# Cover every COPY input plus the recipe and build-argument construction. The
# full web tree is conservative: even ignored source edits invalidate the version.
INPUTS = (
    "ornn-web", "package.json", "bun.lock", "ornn-api/package.json",
    "sdk/typescript/package.json", "scripts/ci/staging-native-image.sh",
    "scripts/ci/staging_web_identity.py",
)
REQUIRED = set(INPUTS[1:]) | {
    "ornn-web/package.json", "ornn-web/vite.config.ts",
    "ornn-web/Dockerfile.staging", "ornn-web/Dockerfile.staging.dockerignore",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(repository, *args):
    return subprocess.check_output(["git", *args], cwd=repository)


def build_inputs(repository=ROOT, ref="HEAD"):
    # Git blob IDs bind exact contents; modes and paths also affect Docker COPY.
    entries = git(repository, "ls-tree", "-r", "-z", "--full-tree", ref, "--", *INPUTS)
    files = []
    for entry in entries.split(b"\0"):
        if not entry:
            continue
        fields, path = entry.split(b"\t", 1)
        mode, kind, blob = fields.decode("ascii").split()
        require(kind == "blob" and mode in ("100644", "100755")
                and re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", blob),
                "Web inputs must be regular tracked files")
        files.append({"path": path.decode("utf-8"), "mode": mode, "blob": blob})
    require(REQUIRED <= {entry["path"] for entry in files}, "Missing web build inputs")
    record = {"schema": SCHEMA, "files": sorted(files, key=lambda item: item["path"])}
    encoded = json.dumps(record, sort_keys=True, separators=(",", ":")).encode()
    return {**record, "identity": "web-" + hashlib.sha256(encoded).hexdigest()}


def checkout_record(repository=ROOT):
    require(not git(repository, "status", "--porcelain", "--untracked-files=all", "--", *INPUTS),
            "Web build inputs differ from the checked-out revision")
    # Native jobs build from a fresh checkout. Refuse ignored extras too, so a
    # generated public asset cannot enter Docker COPY without entering the digest.
    require(not git(repository, "ls-files", "--others", "--", *INPUTS),
            "Untracked files exist in web build inputs")
    revision = git(repository, "rev-parse", "HEAD").decode("ascii").strip()
    require(re.fullmatch(r"[0-9a-f]{40}", revision), "Invalid source revision")
    # Commit identity is evidence about the build, never an input to its SPA version.
    return {**build_inputs(repository), "sourceRevision": revision}


def verify_web_receipt(directory, metadata, revision, repository=ROOT):
    expected = checkout_record(repository)
    require(expected["sourceRevision"] == revision, "Web inputs belong to a different revision")
    require(json.loads((directory / "web-build-inputs.json").read_text()) == expected,
            "Web build-input receipt differs from the checkout")
    require(metadata.get("webBuildIdentity") == expected["identity"]
            and metadata["labels"].get(LABEL) == expected["identity"],
            "Web image differs from its build inputs")
    package = json.loads((repository / "ornn-web/package.json").read_text())
    require(json.loads((directory / "version.json").read_text())
            == {"version": package["version"] + "+" + expected["identity"]},
            "Web runtime version differs from its build inputs")


def write_record(output, repository=ROOT):
    record = checkout_record(repository)
    output.write_text(json.dumps(record, indent=2) + "\n")
    return record["identity"]


if __name__ == "__main__":
    print(write_record(Path(sys.argv[1])))
