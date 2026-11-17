"""Validate the handoff from native staging builds to GHCR publication."""

import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tarfile

try:
    from .staging_scan_receipt import verify_secret_scan
except ImportError:
    from staging_scan_receipt import verify_secret_scan

REPOSITORY = "ChronoAIProject/Ornn"
SOURCE = f"https://github.com/{REPOSITORY}"
USERS = {"api": "1000:1000", "web": "101:101"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def guard(env, mode, machine, head, event=None):
    require(mode in ("build", "publish"), "Unknown staging operation")
    require(env.get("GITHUB_ACTIONS") == "true", "Requires GitHub Actions")
    require(env.get("GITHUB_REPOSITORY") == REPOSITORY, "Unexpected repository")
    require(env.get("COMPONENT") in USERS, "Unknown component")
    require(env.get("RUNNER_ARCH") == "X64" and machine == "x86_64",
            "Requires native x86_64 runner")
    require(re.fullmatch(r"[0-9a-f]{40}", env.get("GITHUB_SHA", "")),
            "Requires full commit SHA")
    require(head == env["GITHUB_SHA"], "Checkout HEAD differs from workflow SHA")
    for name in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        require(re.fullmatch(r"[1-9][0-9]*", env.get(name, "")), f"Invalid {name}")
    event_name = env.get("GITHUB_EVENT_NAME")
    if mode == "build" and event_name == "pull_request":
        pr = (event or {}).get("pull_request", {})
        require(pr.get("head", {}).get("repo", {}).get("full_name") == REPOSITORY,
                "Fork pull requests cannot build publication artifacts")
        require(pr.get("base", {}).get("ref") == "develop", "Unexpected PR base")
        require(re.fullmatch(r"refs/pull/[1-9][0-9]*/merge", env.get("GITHUB_REF", "")),
                "Requires PR merge ref")
    else:
        require(event_name in ("push", "workflow_dispatch"), "Event cannot publish")
        require(env.get("GITHUB_REF") == "refs/heads/develop", "Requires develop ref")


def verify_image(image, component, revision):
    require(image["Os"] == "linux" and image["Architecture"] == "amd64",
            "Image must be linux/amd64")
    require(image["Config"]["User"] == USERS[component], "Unexpected runtime user")
    port = "3802/tcp" if component == "api" else "8080/tcp"
    require(port in image["Config"]["ExposedPorts"], "Missing runtime port")
    labels = image["Config"]["Labels"]
    require(labels.get("org.opencontainers.image.source") == SOURCE, "Wrong source label")
    require(labels.get("org.opencontainers.image.revision") == revision, "Wrong revision label")
    require(labels.get("org.opencontainers.image.version") == f"git-{revision}",
            "Wrong version label")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", image["Id"]), "Invalid image ID")
    require(bool(image["RootFS"]["Layers"]), "Image has no layers")


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def saved_config(archive):
    with tarfile.open(archive, "r:gz") as saved:
        manifests = json.load(saved.extractfile("manifest.json"))
        require(len(manifests) == 1, "Archive must contain exactly one image")
        config = saved.extractfile(manifests[0]["Config"]).read()
    return "sha256:" + hashlib.sha256(config).hexdigest(), json.loads(config)


def verify_config(config, metadata, env):
    verify_loaded({
        "Id": metadata["imageId"], "Os": config["os"],
        "Architecture": config["architecture"], "Config": config["config"],
        "RootFS": {"Layers": config["rootfs"]["diff_ids"]},
    }, metadata, env)


def verify_archive(directory, env, tree):
    metadata = json.loads((directory / "metadata.json").read_text())
    component = env["COMPONENT"]
    archive = directory / f"ornn-{component}-linux-amd64.docker.tar.gz"
    require(metadata["schema"] == "ornn-ci-native-image-v1", "Unknown archive schema")
    require(metadata["component"] == component, "Archive component mismatch")
    require(metadata["source"] == SOURCE, "Archive source mismatch")
    require(metadata["sourceRevision"] == env["GITHUB_SHA"], "Archive revision mismatch")
    require(metadata["sourceTree"] == tree, "Archive tree mismatch")
    require(metadata["workflow"] == {
        "repository": env["GITHUB_REPOSITORY"], "runId": env["GITHUB_RUN_ID"],
        "runAttempt": env["GITHUB_RUN_ATTEMPT"], "ref": env["GITHUB_REF"],
        "event": env["GITHUB_EVENT_NAME"],
    }, "Archive belongs to a different workflow execution")
    require(metadata["platform"] == "linux/amd64", "Archive platform mismatch")
    require(metadata["user"] == USERS[component], "Archive user mismatch")
    require(metadata["archive"] == archive.name, "Unexpected archive filename")
    require(archive.stat().st_size == metadata["archiveBytes"], "Archive size mismatch")
    require(checksum(archive) == metadata["archiveSha256"], "Archive checksum mismatch")
    # Engine image IDs may identify an OCI manifest rather than its config. Bind
    # the actual saved config separately so registry verification works on both.
    digest, config = saved_config(archive)
    require(digest == metadata["configDigest"], "Saved image config digest mismatch")
    verify_config(config, metadata, env)
    for name in ("numericNonroot", "nativeAmd64", "sourceLabels", "containerSmoke"):
        require(metadata["checks"].get(name) is True, f"Missing build check: {name}")
    require(metadata["checks"].get("DBIdentityOrClusterQualification") is False,
            "Packaging smoke is not service qualification")
    original = json.loads((directory / "image-inspect.json").read_text())[0]
    verify_loaded(original, metadata, env)
    verify_secret_scan(directory, metadata)
    return metadata


def verify_loaded(image, metadata, env):
    verify_image(image, env["COMPONENT"], env["GITHUB_SHA"])
    require(image["Id"] == metadata["imageId"], "Loaded image differs from verified image")
    require(image["Config"]["Labels"] == metadata["labels"], "Loaded labels differ")
    require(image["RootFS"]["Layers"] == metadata["layerDiffIds"], "Loaded layers differ")


def publication(metadata, manifest, digest, env):
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", digest), "Invalid remote manifest digest")
    require(manifest["schemaVersion"] == 2, "Unexpected registry manifest schema")
    require(manifest["config"]["digest"] == metadata["configDigest"],
            "Registry image differs from verified image")
    package = f"ghcr.io/chronoaiproject/ornn-staging-{env['COMPONENT']}"
    return {
        "schema": "ornn-staging-publication-v1", "component": env["COMPONENT"],
        "package": package, "tag": env["GITHUB_SHA"], "manifestDigest": digest,
        "configDigest": metadata["configDigest"], "image": f"{package}@{digest}",
        "sourceRevision": metadata["sourceRevision"], "sourceTree": metadata["sourceTree"],
        "archiveSha256": metadata["archiveSha256"], "workflow": metadata["workflow"],
        "platform": metadata["platform"], "user": metadata["user"],
        "probes": {"readiness": "/readyz", "liveness": "/health", "port": 3802}
        if env["COMPONENT"] == "api" else
        {"readiness": "/health", "liveness": "/health", "port": 8080},
    }


def main():
    command = sys.argv[1]
    env = os.environ
    directory = Path("staging-image-out")
    if command == "guard":
        event = json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text())
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        guard(env, sys.argv[2], platform.machine(), head, event)
    elif command == "archive":
        tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], text=True).strip()
        metadata = verify_archive(directory, env, tree)
        print(metadata["imageId"])
    elif command == "inspect":
        image = json.loads((directory / "image-inspect.json").read_text())[0]
        verify_image(image, env["COMPONENT"], env["GITHUB_SHA"])
    elif command == "loaded":
        metadata = json.loads((directory / "metadata.json").read_text())
        image = json.loads((directory / "loaded-inspect.json").read_text())[0]
        verify_loaded(image, metadata, env)
    elif command == "publication":
        metadata = json.loads((directory / "metadata.json").read_text())
        manifest = json.loads((directory / "remote-manifest.json").read_text())
        digest = (directory / "push-digest.txt").read_text().strip()
        receipt = publication(metadata, manifest, digest, env)
        receipt["secretScan"] = verify_secret_scan(directory, metadata)
        (directory / "publication.json").write_text(json.dumps(receipt, indent=2) + "\n")
        with Path(env["GITHUB_STEP_SUMMARY"]).open("a") as summary:
            summary.write(f"### Staging {env['COMPONENT']}\n\n")
            summary.write(f"Image: `{receipt['image']}`\n\n")
            summary.write(f"Source: `{receipt['sourceRevision']}`\n\n")
            summary.write("Packaging smoke passed. Service qualification and package "
                          "visibility must be confirmed before deployment.\n")
        print(receipt["image"])
    elif command == "scan":
        metadata = json.loads((directory / "metadata.json").read_text())
        verify_secret_scan(directory, metadata)
        print("Complete CLEAN scan verified against the exact saved artifact and checkout")
    else:
        raise ValueError(f"Unknown command: {command}")


if __name__ == "__main__":
    main()
