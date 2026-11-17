"""Synthetic images contain runtime-generated, deliberately nonfunctional test material."""

import base64
import gzip
import hashlib
import io
import json
import os
import tarfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fake_key():
    # This is deliberately not a valid private key. Never use real credentials as fixtures.
    return (
        b"-----BEGIN "
        + b"PRIVATE KEY-----\n"
        + base64.b64encode(os.urandom(64))
        + b"\n-----END PRIVATE KEY-----\n"
    )


def tar_bytes(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for name, value in entries:
            member = tarfile.TarInfo(name)
            member.mode = 0o600
            if isinstance(value, tuple):
                member.type, member.linkname = value
                archive.addfile(member)
            else:
                member.size = len(value)
                archive.addfile(member, io.BytesIO(value))
    return output.getvalue()


def configuration(layers, extra=None):
    data = {
        "architecture": "amd64",
        "os": "linux",
        "rootfs": {"type": "layers", "diff_ids": ["sha256:" + digest(layer) for layer in layers]},
        "config": {"Cmd": ["/bin/false"]},
        "history": [{"created_by": "fixture-only"} for layer in layers],
    }
    if extra:
        data.update(extra)
    return json.dumps(data).encode()


def docker_archive(path, layers, extra=None, other=(), tag=None):
    raw_config = configuration(layers, extra)
    config_name = digest(raw_config) + ".json"
    names = [f"layer{i}/layer.tar" for i in range(len(layers))]
    manifest = [{"Config": config_name, "RepoTags": [tag] if tag else [], "Layers": names}]
    entries = [("manifest.json", json.dumps(manifest).encode()), (config_name, raw_config)]
    entries.extend(zip(names, layers))
    entries.extend(other)
    path.write_bytes(tar_bytes(entries))
    return digest(raw_config)


def oci_archive(path, layers, extra=None, compress=True, nested=False):
    entries = []

    def blob(data, media):
        ident = digest(data)
        entries.append(("blobs/sha256/" + ident, data))
        return {"mediaType": media, "size": len(data), "digest": "sha256:" + ident}

    config = blob(configuration(layers, extra), "application/vnd.oci.image.config.v1+json")
    descriptors = [
        blob(
            gzip.compress(layer) if compress else layer,
            "application/vnd.oci.image.layer.v1.tar" + ("+gzip" if compress else ""),
        )
        for layer in layers
    ]
    manifest = {"schemaVersion": 2, "config": config, "layers": descriptors}
    child = blob(json.dumps(manifest).encode(), "application/vnd.oci.image.manifest.v1+json")
    if nested:
        child = blob(
            json.dumps({"schemaVersion": 2, "manifests": [child]}).encode(),
            "application/vnd.oci.image.index.v1+json",
        )
    index = {"schemaVersion": 2, "manifests": [child]}
    entries.extend(
        [("index.json", json.dumps(index).encode()), ("oci-layout", b'{"imageLayoutVersion":"1.0.0"}')]
    )
    path.write_bytes(tar_bytes(entries))
