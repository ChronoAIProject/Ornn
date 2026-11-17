"""Prepare every saved image layer for scanning without following archive links."""

import argparse
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile


def safe_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError("Unsafe path in image archive")
    return path


def credential_path(path):
    parts = path.parts
    name = path.name.lower()
    return (name == ".env" or name.startswith(".env.") or name == ".npmrc"
            or name.endswith(".key") or name in ("credentials", "credentials.json")
            or "kubeconfig" in name or name.startswith(("id_rsa", "id_ed25519"))
            or any(part in (".git", ".aws", ".kube", ".azure") for part in parts)
            or ".config/gcloud" in str(path))


def prepare(archive_path, output):
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    metadata = output / "metadata"
    metadata.mkdir()
    stats = {"layers": 0, "files": 0, "credentialPaths": 0}
    with tarfile.open(archive_path, "r:*") as archive:
        manifests = json.load(archive.extractfile("manifest.json"))
        if len(manifests) != 1:
            raise ValueError("Expected exactly one image in saved archive")
        manifest = manifests[0]
        config = json.load(archive.extractfile(manifest["Config"]))
        (metadata / "config.json").write_text(json.dumps(config))
        (metadata / "history.json").write_text(json.dumps(config.get("history", [])))
        layers = manifest["Layers"]
        if not layers or len(set(layers)) != len(layers):
            raise ValueError("Missing or duplicate image layers")
        for number, layer_name in enumerate(layers):
            layer_output = output / "layers" / str(number)
            layer_output.mkdir(parents=True)
            names = set()
            links = []
            with archive.extractfile(layer_name) as stream:
                with tarfile.open(fileobj=stream, mode="r|*") as layer:
                    for member in layer:
                        if member.name in (".", "./"):
                            continue
                        relative = safe_name(member.name)
                        if credential_path(relative):
                            stats["credentialPaths"] += 1
                        if member.isdir():
                            continue
                        if relative in names:
                            raise ValueError("Duplicate file path within image layer")
                        names.add(relative)
                        if member.issym() or member.islnk():
                            # Scan link text, but never resolve a link onto the host.
                            links.append({"path": str(relative), "target": member.linkname})
                        elif member.isfile():
                            target = layer_output.joinpath(*relative.parts)
                            target.parent.mkdir(parents=True, exist_ok=True)
                            with layer.extractfile(member) as source, target.open("xb") as dest:
                                shutil.copyfileobj(source, dest)
                            target.chmod(0o600)
                            stats["files"] += 1
            (metadata / f"links-{number}.json").write_text(json.dumps(links))
            stats["layers"] += 1
    (output / "scan-input.json").write_text(json.dumps(stats))
    if stats["credentialPaths"]:
        raise ValueError(f"Image contains {stats['credentialPaths']} credential paths (details suppressed)")
    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.archive, args.output)))
