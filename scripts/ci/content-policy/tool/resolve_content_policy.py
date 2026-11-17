#!/usr/bin/env python3
"""Bind reviewed content identities to an unchanged scanner1.0.3 completed report."""

import argparse
import copy
import json
import os
import sys
import tempfile
from pathlib import Path


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, '{"status":"ERROR","error":"invalid-arguments"}\n')


def main(argv=None):
    os.umask(0o077)
    parser = SafeParser(description=__doc__)
    for name in ("scanner", "archive", "report", "catalog", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--component", required=True, choices=("api", "web"))
    parser.add_argument("--review", type=Path)
    parser.add_argument("--proposal", action="store_true")
    args = parser.parse_args(argv)
    sys.path.insert(0, str(args.scanner.resolve()))
    from content_catalog import make_packet, match_findings, read_catalog, tool_identity
    from content_identity import archive_identities
    from image_secrets.common import ScanError, digest_file, json_bytes, write_json
    from image_secrets.gate import assess

    try:
        args.output.mkdir(parents=True, exist_ok=False)
        if bool(args.review) == args.proposal:
            raise ScanError("choose-review-or-proposal")
        result = json_bytes(args.report.read_bytes())
        if (
            result.get("complete") is not True
            or result.get("status") not in ("CLEAN", "FINDINGS")
            or result.get("schema") != "image-secret-scan-v1"
            or result.get("error")
            or result.get("blocking_rules") != "credential"
            or result.get("reviewed_classifications")
            or result.get("input_kind") != "archive"
        ):
            raise ScanError("requires-unclassified-complete-scan")
        files = [
            args.scanner / "scan-image-secrets.sh",
            args.scanner / "scan_image_secrets.py",
        ]
        files += sorted((args.scanner / "image_secrets").glob("*.py"))
        if result["scanner_files"] != {
            str(p.relative_to(args.scanner)): digest_file(p) for p in files
        }:
            raise ScanError("scanner-source-mismatch")
        archive_sha = digest_file(args.archive)
        if archive_sha != result["archive_sha256"]:
            raise ScanError("content-archive-mismatch")
        catalog = read_catalog(args.catalog, result)
        with tempfile.TemporaryDirectory(
            prefix="identity-", dir=args.output
        ) as temporary:
            identities = archive_identities(args.archive, Path(temporary), result)
        if digest_file(args.archive) != archive_sha:
            raise ScanError("content-archive-changed")
        matched, unresolved = match_findings(
            catalog, args.component, result["findings"], identities
        )
        receipt = {
            "schema": "image-content-resolution-v1",
            "proposal": args.proposal,
            "archive_sha256": archive_sha,
            "raw_report_sha256": digest_file(args.report),
            "catalog_sha256": digest_file(args.catalog),
            "adapter_files": tool_identity(),
            "identities": identities,
            "matched": len(matched),
            "unresolved": unresolved,
            "complete": True,
        }
        if args.proposal:
            receipt["status"] = "REVIEW_REQUIRED"
            write_json(args.output / "RESOLUTION.json", receipt)
            return 1
        packet = make_packet(args.catalog, result, matched, args.review)
        packet_path = args.output / "classifications.json"
        write_json(packet_path, packet)
        assessed = copy.deepcopy(result)
        assess(assessed, "credential", packet_path)
        assessed["exit_code"] = 1 if assessed["blocking_findings"] else 0
        write_json(args.output / "REPORT.json", assessed)
        receipt.update(
            status=assessed["status"],
            packet_sha256=digest_file(packet_path),
            review_sha256=digest_file(args.review),
            report_sha256=digest_file(args.output / "REPORT.json"),
        )
        write_json(args.output / "RESOLUTION.json", receipt)
        print(json.dumps({"status": assessed["status"], "counts": assessed["counts"]}))
        return assessed["exit_code"]
    except (Exception, KeyboardInterrupt):  # noqa: BLE001 -- redact third-party errors
        # Archive/JSON exceptions can carry paths or values; none enter public evidence.
        print(
            '{"status":"ERROR","complete":false,"error":"content-policy-resolution-failed"}',
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
