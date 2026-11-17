"""Verify the reviewed content catalog and every link in its scan assessment."""

import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "ornn-content-policy.json"
REVIEW = ROOT / "ornn-content-policy-review.json"
ADAPTER = ROOT / "content-policy" / "tool"


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def adapter_identity():
    return {path.name: checksum(path) for path in sorted(ADAPTER.glob("*.py"))}


def verify_content_receipt(directory, metadata, scan):
    review_pin = REVIEW.with_suffix(".sha256").read_text(encoding="ascii").strip()
    require(re.fullmatch(r"[a-f0-9]{64}", review_pin) and checksum(REVIEW) == review_pin,
            "Content-policy confirmation differs from its committed checksum")
    review = json.loads(REVIEW.read_text())
    adapter = adapter_identity()
    require(bool(adapter) and review.get("verdict") == "GO_CONTENT_POLICY"
            and review.get("reviewer") == "solution-architect-01"
            and review.get("catalog_sha256") == checksum(CATALOG)
            and review.get("adapter_files") == adapter,
            "Missing matching content-policy approval")
    output = directory / "secret-scan"
    raw_path = directory / "secret-scan-raw" / "REPORT.json"
    raw = json.loads(raw_path.read_text())
    resolution_path = output / "RESOLUTION.json"
    resolution = json.loads(resolution_path.read_text())
    packet_path = output / "classifications.json"
    packet = json.loads(packet_path.read_text())
    require(resolution.get("schema") == "image-content-resolution-v1"
            and resolution.get("complete") is True
            and resolution.get("proposal") is False
            and resolution.get("status") == "CLEAN"
            and resolution.get("unresolved") == [], "Incomplete content-policy resolution")
    expected = {
        "archive_sha256": metadata["archiveSha256"],
        "raw_report_sha256": checksum(raw_path),
        "catalog_sha256": checksum(CATALOG),
        "adapter_files": adapter,
        "packet_sha256": checksum(packet_path),
        "review_sha256": checksum(REVIEW),
        "report_sha256": checksum(output / "REPORT.json"),
    }
    require(all(resolution.get(key) == value for key, value in expected.items()),
            "Content-policy receipt identity mismatch")
    require(raw.get("complete") is True and "error" not in raw
            and raw.get("reviewed_classifications") == []
            and type(raw.get("exit_code")) is int
            and (raw.get("status"), raw["exit_code"]) in (("CLEAN", 0), ("FINDINGS", 1)),
            "Missing complete unclassified detector report")
    changed_fields = {"status", "exit_code", "policy", "counts", "blocking_findings",
                      "advisory_findings", "reviewed_classifications"}
    require({k: v for k, v in raw.items() if k not in changed_fields}
            == {k: v for k, v in scan.items() if k not in changed_fields},
            "Content assessment changed detector evidence")
    require(raw.get("policy") == {k: v for k, v in scan.get("policy", {}).items()
                                  if k not in ("classifications_sha256", "classification_review_sha256")},
            "Content assessment changed detector policy")
    identities = resolution.get("identities")
    require(isinstance(identities, dict) and all(
        isinstance(k, str) and isinstance(v, str)
        and re.fullmatch(r"[a-f0-9]{64}", k) and re.fullmatch(r"[a-f0-9]{64}", v)
        for k, v in identities.items()), "Invalid resolved content identities")
    # Replay the reviewed matcher against retained detections. Archive readback
    # occurs in the trusted build job; its immutable artifact binds this receipt.
    sys.path[:0] = [str(ROOT / "image-secret-scan"), str(ADAPTER)]
    from content_catalog import make_packet, match_findings, read_catalog
    from image_secrets.common import ScanError
    try:
        matched, unresolved = match_findings(read_catalog(CATALOG, raw), metadata["component"],
                                             raw["findings"], identities)
        expected_packet = make_packet(CATALOG, raw, matched, REVIEW)
    except (ScanError, KeyError, TypeError):
        raise ValueError("Content classification replay failed") from None
    require(not unresolved and type(resolution.get("matched")) is int
            and resolution["matched"] == len(matched), "Unreviewed content findings")
    require(packet == expected_packet,
            "Classification packet differs from reviewed content matches")
    return {
        "classifications_sha256": expected["packet_sha256"],
        "classification_review_sha256": expected["review_sha256"],
    }, {
        "catalogSha256": expected["catalog_sha256"],
        "reviewSha256": expected["review_sha256"],
        "adapterFiles": adapter,
        "rawReportSha256": expected["raw_report_sha256"],
        "resolutionSha256": checksum(resolution_path),
        "packetSha256": expected["packet_sha256"],
    }
