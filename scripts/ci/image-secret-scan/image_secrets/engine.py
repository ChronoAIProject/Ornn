"""Stable scan engine; archive reader, detector, and policy are injected contracts."""

import json
import shutil
import tarfile
from pathlib import PurePosixPath

from .archive_integrity import tar_trailer
from .common import ScanError, archive_path, copy_stream
from .containers import inspect_nested
from .policy import path_rule


class Stage:
    def __init__(self, root, backend, findings, budget):
        self.root, self.backend, self.findings, self.budget = root, backend, findings, budget
        self.locations = {}
        root.mkdir()

    def add(self, data, location, original_path=None):
        self.budget.reserve(len(data))
        destination = self.root / f"entry-{len(self.locations):08d}.txt"
        destination.write_bytes(data)
        self.locations[destination] = location
        self.findings.inspect(destination, location, original_path)

    def file(self, stream, size, location, original_path=None, depth=0):
        self.budget.reserve(size)
        # Decode containers ourselves by bytes, including disguised nested members.
        # Synthetic names also prevent image-controlled Gitleaks path exclusions.
        destination = self.root / f"entry-{len(self.locations):08d}.txt"
        actual = copy_stream(stream, destination, size)
        if actual != size:
            raise ScanError("truncated-layer-entry")
        self.locations[destination] = location
        original_path = original_path if original_path is not None else location["path"]
        empty_whiteout = size == 0 and PurePosixPath(original_path).name.startswith(".wh.")
        self.findings.inspect(destination, location, None if empty_whiteout else original_path)
        inspect_nested(self, destination, location, depth)

    def inspect_path(self, location, original_path):
        rule = path_rule(original_path)
        if rule:
            self.findings.add(rule, location)

    def finish(self):
        if self.locations:
            self.backend.scan(self.root, self.locations, self.findings)
        shutil.rmtree(self.root)


def decoded_strings(value, pointer="", depth=0):
    if depth > 64:
        raise ScanError("config-nesting-limit")
    if isinstance(value, str):
        yield pointer, value
    elif isinstance(value, dict):
        for key, child in value.items():
            escaped = key.replace("~", "~0").replace("/", "~1")
            # Secret-bearing label keys and values are also inspected as assignments.
            if isinstance(child, str):
                yield pointer + "/" + escaped + "/@assignment", key + "=" + child
            yield from decoded_strings(child, pointer + "/" + escaped, depth + 1)
    elif isinstance(value, list):
        if value and all(isinstance(child, str) for child in value):
            yield pointer + "/@joined", " ".join(value)
        for index, child in enumerate(value):
            yield from decoded_strings(child, pointer + "/" + str(index), depth + 1)


def scan_archive(archive, backend, findings, workspace, budget, progress):
    kind, images = archive.images()
    inventory = {"archive_format": kind, "images": [], "layers": [], "entries": 0}
    stage = Stage(workspace / "metadata", backend, findings, budget)
    for path, raw in archive.metadata:
        stage.add(raw, {"scope": "archive", "image": -1, "layer": -1, "entry": -1, "path": path})
    stage.finish()
    for image_index, image in enumerate(images):
        inventory["images"].append(
            {
                "index": image_index,
                "config_digest": image["config_digest"],
                "manifest": image["manifest"],
                "layers": len(image["layers"]),
            }
        )
        stage = Stage(workspace / "config", backend, findings, budget)
        location = {
            "scope": "config",
            "image": image_index,
            "layer": -1,
            "entry": -1,
            "path": "config/full.json",
        }
        stage.add(image["raw"], location)
        for pointer, value in decoded_strings(image["config"]):
            stage.add(value.encode("utf-8"), dict(location, path="config" + pointer))
        stage.finish()
        for layer_index, (name, diff_id) in enumerate(zip(image["layers"], image["diff_ids"])):
            layer_path = archive.layer(name, diff_id)
            stage = Stage(workspace / "layer", backend, findings, budget)
            summary = {
                "image": image_index,
                "index": layer_index,
                "diff_id": diff_id,
                "entries": 0,
                "files": 0,
                "links": 0,
                "whiteouts": 0,
                "bytes": 0,
            }
            with tarfile.open(layer_path, "r:") as layer:
                for entry_index, entry in enumerate(layer):
                    budget.entry()
                    path = archive_path(entry.name)
                    if entry.issparse():
                        raise ScanError("sparse-layer-unsupported")
                    location = {
                        "scope": "layer",
                        "image": image_index,
                        "layer": layer_index,
                        "entry": entry_index,
                        "path": path,
                    }
                    summary["entries"] += 1
                    if PurePosixPath(path).name.startswith(".wh."):
                        summary["whiteouts"] += 1
                    metadata = {"path": path, "link": entry.linkname, "pax": entry.pax_headers}
                    stage.add(json.dumps(metadata, ensure_ascii=False).encode(), location)
                    if entry.isfile():
                        with layer.extractfile(entry) as stream:
                            stage.file(stream, entry.size, location)
                        summary["files"] += 1
                        summary["bytes"] += entry.size
                    elif entry.issym() or entry.islnk() or entry.isdir() or entry.isdev():
                        if entry.issym() or entry.islnk():
                            summary["links"] += 1
                        rule = path_rule(path)
                        if rule:
                            findings.add(rule, location)
                    else:
                        raise ScanError("unsupported-layer-entry-type")
                tar_trailer(layer, budget.max_bytes)
            stage.finish()
            layer_path.unlink()
            inventory["layers"].append(summary)
            inventory["entries"] += summary["entries"]
            progress(image_index, layer_index, summary["files"])
    return inventory
