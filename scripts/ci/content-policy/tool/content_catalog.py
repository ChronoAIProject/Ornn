"""Exact reviewed content matching; unmatched detections never disappear."""

import hashlib
from pathlib import Path

from image_secrets.common import ScanError, archive_path, digest_file, json_bytes
from image_secrets.gate import CLASSIFICATIONS, CONTENT_REVIEWERS, valid_digest
from content_bundles import catalog_entries, normalized_scope


def path_hash(path):
    return "path-sha256:" + hashlib.sha256(path.encode()).hexdigest()


def read_catalog(path, result):
    catalog = json_bytes(Path(path).read_bytes())
    for key in ("scanner_version", "gitleaks_version"):
        if catalog.get(key) != result.get(key):
            raise ScanError("content-policy-version-mismatch")
    for key in ("allowlist_sha256", "gitleaks_rules_sha256"):
        if catalog.get(key) != result["policy"].get(key):
            raise ScanError("content-policy-detector-mismatch")
    schema = catalog.get("schema")
    if schema not in {"image-secret-content-policy-v1", "image-secret-content-policy-v2"}:
        raise ScanError("invalid-content-policy-schema")
    if schema == "image-secret-content-policy-v1" and "bundle_candidates" in catalog:
        raise ScanError("bundle-candidates-require-v2")
    index = {}
    for entry in catalog["entries"]:
        path = archive_path(entry["path"])
        if (
            path != entry["path"]
            or entry["component"] not in ("api", "web")
            or not valid_digest(entry["file_sha256"])
            or entry["classification"] not in CLASSIFICATIONS
            or not isinstance(entry["reason"], str)
            or not entry["reason"].strip()
        ):
            raise ScanError("invalid-content-policy-entry")
        key = (entry["component"], path_hash(path), entry["rule"], entry["file_sha256"])
        index.setdefault(key, []).append(entry)
    if schema == "image-secret-content-policy-v2":
        for key, entry in catalog_entries(catalog):
            if any(old["classification"] == "REAL" and old["component"] == entry["component"]
                   and old["rule"] == entry["rule"]
                   and old.get("candidate_sha256") == entry["candidate_sha256"]
                   and normalized_scope(old["path"]) == key[2] for old in catalog["entries"]):
                raise ScanError("bundle-candidate-conflicts-with-real")
            index[key] = [entry]
    return index


def match_findings(index, component, findings, identities, bundle_scopes=None):
    bundle_scopes = {} if bundle_scopes is None else bundle_scopes
    matched, unresolved = [], []
    for finding in findings:
        if finding["rule"] == "gitleaks.image-high-entropy":
            continue
        identity = identities.get(finding["finding_id"])
        key = (component, finding["path"], finding["rule"], identity)
        candidates = index.get(key, []) if identity else []
        candidates = [
            entry
            for entry in candidates
            if all(
                finding.get(field) == entry[field]
                for field in ("candidate_sha256", "line")
                if field in entry
            )
        ]
        # Exact entries retain precedence, including REAL classifications. Scoped
        # reuse requires a freshly validated regular-file occurrence and current
        # file digest; the old bundle digest is never used as its identity.
        if not candidates and identity and finding.get("file_sha256") == identity:
            scope = bundle_scopes.get(finding["finding_id"])
            if (scope and finding.get("scope") == "layer"
                    and valid_digest(finding.get("candidate_sha256"))):
                candidates = index.get(("bundle", component, scope, finding["rule"],
                                        finding["candidate_sha256"]), [])
        if not candidates:
            unresolved.append(finding)
            continue
        decisions = {(row["classification"], row["reason"]) for row in candidates}
        if len(decisions) != 1:
            raise ScanError("ambiguous-content-policy-entry")
        classification, reason = decisions.pop()
        matched.append(
            {
                "finding_id": finding["finding_id"],
                "classification": classification,
                "reason": reason,
            }
        )
    return sorted(matched, key=lambda row: row["finding_id"]), unresolved


def tool_identity():
    root = Path(__file__).resolve().parent
    files = [*root.glob("*.py"), *root.glob("*.cjs"), *(root / "vendor").glob("*")]
    return {p.relative_to(root).as_posix(): digest_file(p) for p in sorted(files) if p.is_file()}


def make_packet(catalog_path, result, matched, review_path):
    review = json_bytes(review_path.read_bytes())
    if (
        review.get("verdict") != "GO_CONTENT_POLICY"
        or review.get("reviewer") not in CONTENT_REVIEWERS
        or review.get("catalog_sha256") != digest_file(catalog_path)
        or review.get("adapter_files") != tool_identity()
    ):
        raise ScanError("content-policy-review-mismatch")
    return {
        "schema": "image-secret-classifications-v1",
        "archive_sha256": result["archive_sha256"],
        "scanner_version": result["scanner_version"],
        "gitleaks_rules_sha256": result["policy"]["gitleaks_rules_sha256"],
        "allowlist_sha256": result["policy"]["allowlist_sha256"],
        "review": {
            "reviewer": review["reviewer"],
            "reference": "content-policy-sha256:" + digest_file(catalog_path),
            "report_sha256": digest_file(review_path),
        },
        "entries": matched,
    }
