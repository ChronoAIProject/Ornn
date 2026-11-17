"""Validate complete Policy A decisions without retaining detector payloads."""

import re


def require(condition, message):
    if not condition:
        raise ValueError(message)


def indexed(items):
    require(isinstance(items, list), "Missing scan decision array")
    result = {}
    for item in items:
        require(isinstance(item, dict), "Invalid scan decision entry")
        identity = item.get("finding_id")
        require(
            isinstance(identity, str)
            and re.fullmatch(r"[a-f0-9]{64}", identity)
            and identity not in result,
            "Invalid or duplicate finding identity",
        )
        result[identity] = item
    return result


def verify_decision(scan, classification_sha256=None, review_sha256=None):
    require(
        scan.get("scanner_version") == "1.0.3"
        and scan.get("blocking_rules") == "credential",
        "Unexpected scan policy mode",
    )
    require(
        scan.get("status") == "CLEAN"
        and scan.get("complete") is True
        and type(scan.get("exit_code")) is int
        and scan["exit_code"] == 0
        and "error" not in scan
        and scan.get("blocking_findings") == [],
        "Missing complete Policy A pass",
    )
    findings = indexed(scan.get("findings"))
    advisory = indexed(scan.get("advisory_findings"))
    reviewed = indexed(scan.get("reviewed_classifications"))
    require(
        not (set(advisory) & set(reviewed))
        and set(advisory) | set(reviewed) == set(findings),
        "Incomplete or overlapping scan disposition",
    )
    for identity, entry in advisory.items():
        require(
            entry == findings[identity]
            and entry.get("rule") == "gitleaks.image-high-entropy",
            "Only generic entropy may be automatically advisory",
        )
    for identity, entry in reviewed.items():
        require(
            entry.get("classification")
            in ("library-example", "test-fixture", "public-material")
            and {key: value for key, value in entry.items() if key != "classification"}
            == findings[identity],
            "Invalid or REAL reviewed finding",
        )
    policy = scan.get("policy", {})
    if classification_sha256 is None:
        require(
            not reviewed
            and "classifications_sha256" not in policy
            and "classification_review_sha256" not in policy,
            "Unapproved classification packet",
        )
    else:
        require(
            all(
                isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value)
                for value in (classification_sha256, review_sha256)
            ),
            "Invalid approved classification identity",
        )
        require(
            policy.get("classifications_sha256") == classification_sha256
            and policy.get("classification_review_sha256") == review_sha256,
            "Classification or review identity mismatch",
        )
    require(isinstance(scan.get("allowlisted"), list), "Missing allowlist decisions")
    expected = {
        "detected": len(findings),
        "blocking": 0,
        "advisory": len(advisory),
        "reviewed": len(reviewed),
        "allowlisted": len(scan["allowlisted"]),
    }
    counts = scan.get("counts")
    require(
        isinstance(counts, dict)
        and set(counts) == set(expected)
        and all(
            type(counts[key]) is int and counts[key] == value
            for key, value in expected.items()
        ),
        "Inconsistent scan decision counts",
    )
    return {
        "blockingRules": "credential",
        "scannerVersion": "1.0.3",
        "counts": expected,
    }
