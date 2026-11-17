"""Preserve the exact OCI manifest/config/layers already present in docker save."""

import json
import re
import tarfile

from staging_image import checksum, require


def blob_name(descriptor):
    require(re.fullmatch(r"sha256:[a-f0-9]{64}", descriptor["digest"]), "Invalid OCI digest")
    require(type(descriptor["size"]) is int and 0 < descriptor["size"] < 4 * 1024**3,
            "Invalid OCI blob size")
    return "blobs/" + descriptor["digest"].replace(":", "/")


def verify_manifest(manifest, metadata):
    require(manifest["schemaVersion"] == 2
            and manifest["mediaType"] == "application/vnd.oci.image.manifest.v1+json",
            "Expected a single OCI image manifest")
    require(manifest["config"]["digest"] == metadata["configDigest"]
            and manifest["config"]["mediaType"] == "application/vnd.oci.image.config.v1+json",
            "OCI config differs from scanned archive")
    require([d["digest"] for d in manifest["layers"]] == metadata["layerDiffIds"]
            and all(d["mediaType"] == "application/vnd.oci.image.layer.v1.tar"
                    for d in manifest["layers"]), "OCI layers differ from scanned archive")


def extract_layout(archive, output, metadata):
    output.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive, "r:gz") as saved:
        names = [member.name for member in saved.getmembers()]
        require(len(names) == len(set(names)), "Duplicate archive member")

        def read_json(name):
            entry = saved.getmember(name)
            require(entry.isfile() and 0 < entry.size <= 1024 * 1024, "Invalid OCI JSON member")
            return json.load(saved.extractfile(entry))

        index = read_json("index.json")
        require(index["schemaVersion"] == 2 and len(index["manifests"]) == 1,
                "Expected one OCI manifest")
        descriptor = index["manifests"][0]
        require(descriptor["mediaType"] == "application/vnd.oci.image.manifest.v1+json",
                "Expected OCI manifest descriptor")
        manifest = read_json(blob_name(descriptor))
        verify_manifest(manifest, metadata)
        docker = read_json("manifest.json")
        require(len(docker) == 1 and docker[0]["Config"] == blob_name(manifest["config"])
                and docker[0]["Layers"] == [blob_name(d) for d in manifest["layers"]],
                "Docker and OCI archive graphs disagree")
        # Never extract arbitrary archive paths, symlinks, or the image filesystem.
        for desc in [descriptor, manifest["config"], *manifest["layers"]]:
            name = blob_name(desc)
            member = saved.getmember(name)
            require(member.isfile() and member.size == desc["size"], "Invalid OCI blob member")
            dest = output / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("xb") as target, saved.extractfile(member) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    target.write(chunk)
            require("sha256:" + checksum(dest) == desc["digest"], "OCI blob digest mismatch")
        layout = read_json("oci-layout")
        require(layout == {"imageLayoutVersion": "1.0.0"}, "Invalid OCI layout")
        (output / "oci-layout").write_text(json.dumps(layout) + "\n")
        (output / "index.json").write_text(json.dumps(index) + "\n")
    return manifest, descriptor["digest"]


def verify_layout(layout, manifest, digest, metadata):
    index = json.loads((layout / "index.json").read_text())
    require(index["schemaVersion"] == 2 and len(index["manifests"]) == 1,
            "Invalid pulled OCI index")
    descriptor = index["manifests"][0]
    require(descriptor["digest"] == digest, "Registry manifest changed")
    verify_manifest(manifest, metadata)
    for blob in [descriptor, manifest["config"], *manifest["layers"]]:
        path = layout / blob_name(blob)
        require(path.is_file() and not path.is_symlink() and path.stat().st_size == blob["size"]
                and "sha256:" + checksum(path) == blob["digest"], "OCI blob mismatch")
    require(json.loads((layout / blob_name(descriptor)).read_text()) == manifest,
            "OCI manifest content mismatch")
