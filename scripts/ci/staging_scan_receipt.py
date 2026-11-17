"""Bind a complete shared-scanner verdict to this checkout and saved image."""

import hashlib
import json
from pathlib import Path

SCANNER = Path(__file__).resolve().parent / "image-secret-scan"
PREFLIGHT = Path(__file__).resolve().parent / "staging_scan_inputs.py"
ALLOWLIST = Path(__file__).resolve().parent / "ornn-image-allowlist.json"


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def scanner_identity(directory):
    files = [directory / "scan-image-secrets.sh", directory / "scan_image_secrets.py"]
    modules = sorted((directory / "image_secrets").glob("*.py"))
    require(bool(modules), "Missing shared scanner modules")
    return {str(path.relative_to(directory)): checksum(path) for path in files + modules}


def verify_image_scan_receipt(directory, metadata):
    preflight = json.loads((directory / "scan-preflight.json").read_text())
    require(preflight.get("schema") == "ornn-image-preflight-v1"
            and preflight.get("archiveSha256") == metadata["archiveSha256"]
            and preflight.get("extractorSha256") == checksum(PREFLIGHT)
            and preflight.get("layers") == len(metadata["layerDiffIds"])
            and preflight.get("files", 0) > 0 and preflight.get("credentialPaths") == 0,
            "Missing matching archive preflight receipt")
    report_path = directory / "secret-scan" / "REPORT.json"
    scan = json.loads(report_path.read_text())
    require(scan.get("schema") == "image-secret-scan-v1", "Unknown secret scan schema")
    require(scan.get("status") == "CLEAN" and scan.get("complete") is True
            and type(scan.get("exit_code")) is int and scan["exit_code"] == 0
            and scan.get("findings") == [] and "error" not in scan,
            "Missing complete CLEAN image secret scan")
    require(scan.get("input_kind") == "archive", "Secret scan must inspect the saved archive")
    require(scan.get("gitleaks_version") == "8.30.1", "Unexpected image secret scanner version")
    require(scan.get("archive_sha256") == metadata["archiveSha256"],
            "Secret scan does not cover this archive")
    require(checksum(directory / metadata["archive"]) == metadata["archiveSha256"],
            "Archive changed during image secret scan")
    policy = {
        "gitleaks_rules_sha256": checksum(SCANNER / "gitleaks.toml"),
        "allowlist_sha256": checksum(ALLOWLIST),
    }
    require(scan.get("policy") == policy, "Secret scan policy differs from this checkout")
    require(scan.get("scanner_files") == scanner_identity(SCANNER),
            "Secret scanner code differs from this checkout")
    inventory = scan["inventory"]
    images, layers = inventory["images"], inventory["layers"]
    require(len(images) == 1 and images[0]["index"] == 0
            and images[0]["config_digest"] == metadata["configDigest"],
            "Secret scan config differs from this image")
    expected_layers = metadata["layerDiffIds"]
    require(bool(expected_layers) and images[0]["layers"] == len(expected_layers)
            and len(layers) == len(expected_layers), "Incomplete image layer scan")
    for index, (layer, diff_id) in enumerate(zip(layers, expected_layers)):
        require(layer["image"] == 0 and layer["index"] == index and layer["diff_id"] == diff_id,
                "Secret scan layer differs from this image")
    require(inventory["entries"] > 0 and scan["scanned_bytes"] > 0,
            "Empty image secret scan inventory")
    return {
        "schema": scan["schema"], "status": "CLEAN", "complete": True,
        "reportSha256": checksum(report_path), "archiveSha256": scan["archive_sha256"],
        "gitleaksVersion": scan["gitleaks_version"], "policy": policy,
        "scannerFiles": scan["scanner_files"], "layers": len(layers),
        "preflightSha256": checksum(directory / "scan-preflight.json"),
    }
