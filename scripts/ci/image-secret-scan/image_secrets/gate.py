"""Publication decisions are separate from complete image detection."""

import re

from .common import ScanError, digest_bytes, json_bytes

CLASSIFICATIONS = frozenset({"library-example", "test-fixture", "public-material", "REAL"})
CONTENT_REVIEWERS = frozenset({"solution-architect-01", "solution-architect-03"})
ADVISORY_RULES = frozenset({"gitleaks.image-high-entropy"})


def valid_digest(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def read_classifications(path, result):
    with path.open("rb") as stream:
        packet_bytes = stream.read(16 * 1024 * 1024 + 1)
    if len(packet_bytes) > 16 * 1024 * 1024:
        raise ScanError("classification-packet-too-large")
    packet = json_bytes(packet_bytes)
    fields = {
        "schema",
        "archive_sha256",
        "scanner_version",
        "gitleaks_rules_sha256",
        "allowlist_sha256",
        "review",
        "entries",
    }
    if not isinstance(packet, dict) or set(packet) != fields:
        raise ScanError("invalid-classification-packet")
    if (
        packet["schema"] != "image-secret-classifications-v1"
        or packet["scanner_version"] != result["scanner_version"]
        or packet["archive_sha256"] != result["archive_sha256"]
        or packet["gitleaks_rules_sha256"] != result["policy"]["gitleaks_rules_sha256"]
        or packet["allowlist_sha256"] != result["policy"]["allowlist_sha256"]
    ):
        raise ScanError("classification-artifact-or-policy-mismatch")
    review = packet["review"]
    if (
        not isinstance(review, dict)
        or set(review) != {"reviewer", "reference", "report_sha256"}
        or review["reviewer"] not in CONTENT_REVIEWERS
        or not isinstance(review["reference"], str)
        or not review["reference"].strip()
        or not valid_digest(review["report_sha256"])
        or not isinstance(packet["entries"], list)
    ):
        raise ScanError("invalid-classification-review")
    entries = {}
    for entry in packet["entries"]:
        if (
            not isinstance(entry, dict)
            or set(entry) != {"finding_id", "classification", "reason"}
            or not valid_digest(entry["finding_id"])
            or not isinstance(entry["classification"], str)
            or entry["classification"] not in CLASSIFICATIONS
            or not isinstance(entry["reason"], str)
            or not entry["reason"].strip()
            or entry["finding_id"] in entries
        ):
            raise ScanError("invalid-classification-entry")
        entries[entry["finding_id"]] = entry["classification"]
    observed = {item["finding_id"] for item in result["findings"]}
    if not set(entries).issubset(observed):
        raise ScanError("classification-finding-not-observed")
    result["policy"]["classifications_sha256"] = digest_bytes(packet_bytes)
    result["policy"]["classification_review_sha256"] = review["report_sha256"]
    return entries


def assess(result, mode, classifications=None):
    """Never suppress detection. Only an explicit mode changes blocking semantics."""
    if mode not in ("all", "credential"):
        raise ScanError("invalid-blocking-mode")
    if classifications is not None and mode != "credential":
        raise ScanError("classifications-require-credential-mode")
    decisions = read_classifications(classifications, result) if classifications else {}
    blocking, advisory, reviewed = [], [], []
    for finding in result["findings"]:
        classification = decisions.get(finding["finding_id"])
        if classification:
            item = dict(finding, classification=classification)
            reviewed.append(item)
            if classification == "REAL":
                blocking.append(item)
        elif mode == "credential" and finding["rule"] in ADVISORY_RULES:
            advisory.append(finding)
        else:
            # Unknown/provider rules and unresolved path heuristics remain blocking.
            # A filename or extension alone cannot establish public certificate content.
            blocking.append(finding)
    result.update(
        blocking_rules=mode,
        blocking_findings=blocking,
        advisory_findings=advisory,
        reviewed_classifications=reviewed,
        counts={
            "detected": len(result["findings"]),
            "blocking": len(blocking),
            "advisory": len(advisory),
            "reviewed": len(reviewed),
            "allowlisted": len(result["allowlisted"]),
        },
    )
    result["status"] = "FINDINGS" if blocking else "CLEAN"
