"""Docker-save / OCI archive traversal, with digest and descriptor validation."""

import gzip
import hashlib
import re
import subprocess
import tarfile
import threading

from .common import ScanError, archive_path, copy_stream, digest_file, json_bytes

DIGEST = re.compile(r"^sha256:([a-f0-9]{64})$")
INDEX_TYPES = {
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
}
IMAGE_TYPES = {
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
}


class ImageArchive:
    def __init__(self, path, workspace, budget, timeout=900):
        self.path = path
        self.workspace = workspace
        self.budget = budget
        self.timeout = timeout
        self.tar = None
        self.members = {}
        self.metadata = []
        self.visited = set()

    def __enter__(self):
        try:
            self.tar = tarfile.open(self.path, "r:*")
            total = 0
            for member in self.tar:
                self.budget.entry()
                name = archive_path(member.name)
                if name in self.members:
                    raise ScanError("duplicate-outer-archive-entry")
                if member.issparse():
                    raise ScanError("sparse-archive-unsupported")
                total += member.size
                if total > self.budget.max_bytes:
                    raise ScanError("archive-byte-budget-exceeded")
                self.members[name] = member
            return self
        except BaseException:
            if self.tar:
                self.tar.close()
            raise

    def __exit__(self, *unused):
        self.tar.close()

    def stream(self, name):
        member = self.members.get(archive_path(name))
        if member is None or not member.isfile() or member.issparse():
            raise ScanError("missing-or-nonregular-archive-payload")
        stream = self.tar.extractfile(member)
        if stream is None:
            raise ScanError("missing-archive-payload")
        return stream

    def read(self, name, limit=64 * 1024 * 1024):
        with self.stream(name) as stream:
            value = stream.read(limit + 1)
        if len(value) > limit:
            raise ScanError("metadata-size-limit")
        return value

    def descriptor(self, desc):
        if not isinstance(desc, dict) or not DIGEST.fullmatch(str(desc.get("digest", ""))):
            raise ScanError("unsupported-descriptor-digest")
        size = desc.get("size")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ScanError("invalid-descriptor-size")
        name = "blobs/sha256/" + desc["digest"][7:]
        member = self.members.get(name)
        if member is None or member.size != size:
            raise ScanError("descriptor-size-mismatch")
        digest = hashlib.sha256()
        with self.stream(name) as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != desc["digest"][7:]:
            raise ScanError("descriptor-digest-mismatch")
        return name

    def images(self):
        if "oci-layout" in self.members:
            layout = json_bytes(self.read("oci-layout"))
            if layout != {"imageLayoutVersion": "1.0.0"}:
                raise ScanError("unsupported-oci-layout")
            raw = self.read("index.json")
            index = json_bytes(raw)
            self.metadata.append(("archive/index.json", raw))
            images = self.walk_index(index, set(), 0)
            kind = "oci"
        elif "manifest.json" in self.members:
            raw = self.read("manifest.json")
            manifest = json_bytes(raw)
            self.metadata.append(("archive/manifest.json", raw))
            if not isinstance(manifest, list) or not manifest:
                raise ScanError("empty-docker-manifest")
            images = []
            for item in manifest:
                if not isinstance(item, dict) or not isinstance(item.get("Layers"), list):
                    raise ScanError("invalid-docker-manifest")
                config = self.read(item.get("Config"))
                name = archive_path(item.get("Config"))
                match = re.fullmatch(r"(?:blobs/sha256/)?([0-9a-f]{64})(?:\.json)?", name)
                if match and hashlib.sha256(config).hexdigest() != match[1]:
                    raise ScanError("config-filename-digest-mismatch")
                images.append(self.image(config, item["Layers"]))
            kind = "docker"
        else:
            raise ScanError("unsupported-image-archive")
        if not images:
            raise ScanError("no-image-manifests")
        return kind, images

    def walk_index(self, index, active, depth):
        if depth > 16 or not isinstance(index, dict) or index.get("schemaVersion") != 2:
            raise ScanError("invalid-or-deep-oci-index")
        manifests = index.get("manifests")
        if not isinstance(manifests, list) or not manifests:
            raise ScanError("empty-oci-index")
        result = []
        for descriptor in manifests:
            name = self.descriptor(descriptor)
            if name in active:
                raise ScanError("oci-descriptor-cycle")
            if name in self.visited:
                continue
            self.visited.add(name)
            raw = self.read(name)
            data = json_bytes(raw)
            self.metadata.append(("archive/manifest/" + descriptor["digest"], raw))
            media = descriptor.get("mediaType")
            if media in INDEX_TYPES:
                result.extend(self.walk_index(data, active | {name}, depth + 1))
            elif media in IMAGE_TYPES:
                if not isinstance(data, dict) or data.get("schemaVersion") != 2:
                    raise ScanError("invalid-image-manifest")
                config = self.read(self.descriptor(data.get("config")))
                if not isinstance(data.get("layers"), list):
                    raise ScanError("invalid-image-layers")
                layers = [self.descriptor(layer) for layer in data["layers"]]
                result.append(self.image(config, layers, descriptor["digest"]))
            else:
                # An attestation/unknown artifact must not disappear behind a CLEAN verdict.
                raise ScanError("unsupported-oci-manifest-media-type")
        return result

    @staticmethod
    def image(raw, layers, manifest=None):
        config = json_bytes(raw)
        if not isinstance(config, dict) or not isinstance(config.get("rootfs"), dict):
            raise ScanError("invalid-image-config")
        rootfs = config["rootfs"]
        diffs = rootfs.get("diff_ids")
        if rootfs.get("type") != "layers" or not isinstance(diffs, list) or len(diffs) != len(layers):
            raise ScanError("config-layer-count-mismatch")
        if any(not isinstance(d, str) or not DIGEST.fullmatch(d) for d in diffs):
            raise ScanError("invalid-layer-diff-id")
        return {
            "config": config,
            "raw": raw,
            "layers": layers,
            "diff_ids": diffs,
            "config_digest": "sha256:" + hashlib.sha256(raw).hexdigest(),
            "manifest": manifest,
        }

    def layer(self, name, expected):
        packed = self.workspace / "packed-layer"
        unpacked = self.workspace / "layer.tar"
        with self.stream(name) as stream:
            copy_stream(stream, packed, self.budget.max_bytes)
        with packed.open("rb") as stream:
            magic = stream.read(4)
        if magic[:2] == b"\x1f\x8b":
            with gzip.open(packed, "rb") as stream:
                copy_stream(stream, unpacked, self.budget.max_bytes)
        elif magic == b"\x28\xb5\x2f\xfd":
            # Streaming stdout is capped even for a hostile compressed layer.
            try:
                proc = subprocess.Popen(
                    ["zstd", "-d", "-q", "-c", str(packed)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
                )
            except OSError as error:
                raise ScanError("zstd-unavailable") from error
            timer = threading.Timer(self.timeout, proc.kill)
            timer.start()
            try:
                copy_stream(proc.stdout, unpacked, self.budget.max_bytes)
                if proc.wait(timeout=self.timeout) != 0:
                    raise ScanError("zstd-decompression-failed")
            finally:
                timer.cancel()
                timer.join()
                proc.stdout.close()
                if proc.poll() is None:
                    proc.kill()
                proc.wait()
        else:
            packed.rename(unpacked)
        packed.unlink(missing_ok=True)
        if "sha256:" + digest_file(unpacked) != expected:
            raise ScanError("layer-diff-id-mismatch")
        return unpacked
