"""Publish/reuse only a completely scanned, retained native OCI artifact."""

import json
import os
from pathlib import Path
import subprocess

from staging_artifact import producer_environment
from staging_image import verify_archive
from staging_oci import extract_layout
from staging_registry import CraneRegistry, publish_exact
from staging_registry_history import GithubPackageHistory


def main():
    env = os.environ
    directory = Path("staging-image-out")
    selection = json.loads(Path("staging-artifact.json").read_text())
    artifact_env = producer_environment(env, selection)
    tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], text=True).strip()
    # Unchanged validator replays the complete Policy A receipt before any write.
    metadata = verify_archive(directory, artifact_env, tree)
    layout = directory / "publication-oci"
    manifest, digest = extract_layout(directory / metadata["archive"], layout, metadata)
    target = f"ghcr.io/chronoaiproject/ornn-{env['COMPONENT']}:{env['GITHUB_SHA']}"
    print(f"Verify or publish exact {env['COMPONENT']} manifest {digest}", flush=True)
    observations = {}
    action = publish_exact(CraneRegistry(), target, layout, directory / "registry-oci",
                           manifest, digest, metadata, history=GithubPackageHistory(),
                           observations=observations)
    # Feed the unchanged workflow receipt generator the verified remote identity.
    (directory / "push-digest.txt").write_text(digest + "\n")
    (directory / "remote-manifest.json").write_text(json.dumps(manifest) + "\n")
    (directory / "publication-action.json").write_text(json.dumps({
        "action": action, "manifestDigest": digest,
        "artifactId": selection["artifactId"], "buildAttempt": selection["buildAttempt"],
        "publicationAttempt": env["GITHUB_RUN_ATTEMPT"],
    }, indent=2) + "\n")
    (directory / "registry-observation.json").write_text(json.dumps(observations, indent=2) + "\n")
    print(f"Exact image {action}; full registry blob verification passed", flush=True)


if __name__ == "__main__":
    main()
