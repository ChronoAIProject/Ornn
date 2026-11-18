"""Compare two saved API images; never publishes or issues deployment receipts."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile


def layers(archive):
    with tarfile.open(archive) as saved:
        index = json.load(saved.extractfile("manifest.json"))
        if len(index) != 1:
            raise ValueError("Expected exactly one image")
        result = []
        config = json.load(saved.extractfile(index[0]["Config"]))
        for name, expected in zip(index[0]["Layers"], config["rootfs"]["diff_ids"], strict=True):
            h = hashlib.sha256()
            with saved.extractfile(name) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    h.update(block)
            digest = "sha256:" + h.hexdigest()
            if digest != expected:
                raise ValueError("Layer bytes differ from image config")
            result.append({"digest": digest, "bytes": saved.getmember(name).size})
        return result


def compare(first, second):
    if len(first) < 3 or len(first) != len(second):
        raise ValueError("Expected base, dependencies and app layers")
    if first[:-1] != second[:-1] or first[-1]["digest"] == second[-1]["digest"]:
        raise ValueError("Only the final application layer may change")
    if second[-1]["bytes"] >= 5 * 1024 * 1024:
        raise ValueError("Application layer unexpectedly includes runtime/dependencies")
    return {"result": "PASS", "first": first, "second": second,
            "shared_bytes": sum(row["bytes"] for row in first[:-1]),
            "changed_bytes": second[-1]["bytes"]}


if __name__ == "__main__":
    report = compare(layers(sys.argv[1]), layers(sys.argv[2]))
    Path(sys.argv[3]).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
