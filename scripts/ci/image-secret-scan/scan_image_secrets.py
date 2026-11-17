"""Public image scan gate: 0 clean, 1 findings, 2 incomplete/error."""

import argparse
import datetime
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

from image_secrets.archive import ImageArchive
from image_secrets.backend import Gitleaks
from image_secrets.common import Budget, ScanError, digest_file, write_json
from image_secrets.engine import scan_archive
from image_secrets.gate import assess
from image_secrets.policy import Allowlist, Findings

HERE = Path(__file__).resolve().parent
VERSION = "1.0.3"


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse normally repeats invalid argument values, which can contain credentials.
        self.exit(2, '{"status":"ERROR","error":"invalid-arguments"}\n')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def image_export(reference, destination, timeout):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/@-]{0,511}", reference) or reference.count("@") > 1:
        raise ScanError("invalid-image-reference")
    # Resolve mutable tags once; save by immutable local ID, never by the mutable tag.
    inspected = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", reference],
        check=False,
        capture_output=True,
        timeout=timeout,
    )
    image_id = inspected.stdout.decode("ascii", "replace").strip()
    if inspected.returncode or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise ScanError("local-image-inspect-failed")
    result = subprocess.run(
        ["docker", "image", "save", "--output", str(destination), image_id],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=timeout,
    )
    if result.returncode:
        raise ScanError("image-export-failed")
    return image_id


def arguments(argv):
    parser = SafeArgumentParser(description=__doc__)
    parser.add_argument("--version", action="version", version="scan-image-secrets " + VERSION)
    parser.add_argument("input", help="Local image reference or OCI/docker-save tar archive")
    parser.add_argument("--input-kind", choices=["auto", "image", "archive"], default="auto")
    parser.add_argument(
        "--output", required=True, type=Path, help="New directory for sanitized JSON/text reports"
    )
    parser.add_argument("--allowlist", type=Path, default=HERE / "allowlist.json")
    parser.add_argument("--blocking-rules", choices=["all", "credential"], default="all")
    parser.add_argument(
        "--classifications", type=Path, help="SA-01 classifications bound to this exact archive"
    )
    parser.add_argument("--tmpdir", type=Path, help="Private temporary parent with sufficient disk space")
    parser.add_argument("--max-bytes", type=int, default=20 * 1024**3)
    parser.add_argument("--max-entries", type=int, default=1000000)
    parser.add_argument("--timeout", type=int, default=900, help="Per subprocess timeout in seconds")
    parser.add_argument(
        "--expected-archive-sha256", help="Optional external binding to a previously saved tar"
    )
    return parser.parse_args(argv)


def progress(image, layer, files):
    print(
        json.dumps({"event": "layer-scanned", "image": image, "layer": layer, "files": files}),
        file=sys.stderr,
        flush=True,
    )


def report_text(result):
    lines = [
        "Image secret scan: " + result["status"],
        f"Findings: {len(result['findings'])}; allowlisted: {len(result['allowlisted'])}",
    ]
    if "counts" in result:
        counts = result["counts"]
        lines.append(
            f"Blocking mode: {result['blocking_rules']}; blocking: {counts['blocking']}; "
            f"advisory: {counts['advisory']}; reviewed: {counts['reviewed']}"
        )
    if result.get("error"):
        lines.append("Scanner error: " + result["error"])
    displayed = result.get("blocking_findings", result["findings"])
    for item in displayed[:100]:
        # JSON quoting prevents hostile filenames from injecting terminal control sequences.
        lines.append(
            f"image={item['image']} layer={item['layer']} entry={item['entry']} "
            f"{item['rule']} {json.dumps(item['path'], ensure_ascii=True)}"
        )
    if len(displayed) > 100:
        lines.append("Additional finding paths are in REPORT.json.")
    return "\n".join(lines) + "\n"


def main(argv=None):
    os.umask(0o077)
    args = arguments(argv)
    result = {
        "schema": "image-secret-scan-v1",
        "scanner_version": VERSION,
        "started_at": now(),
        "status": "ERROR",
        "findings": [],
        "allowlisted": [],
        "complete": False,
        "blocking_rules": args.blocking_rules,
    }
    findings = None
    try:
        args.output.mkdir(parents=True, exist_ok=False)
    except OSError:
        print('{"status":"ERROR","error":"output-must-be-new-directory"}', file=sys.stderr)
        return 2
    try:
        if args.classifications and args.blocking_rules != "credential":
            raise ScanError("classifications-require-credential-mode")
        if min(args.max_bytes, args.max_entries, args.timeout) <= 0:
            raise ScanError("invalid-resource-limit")
        if args.expected_archive_sha256 and not re.fullmatch(r"[a-f0-9]{64}", args.expected_archive_sha256):
            raise ScanError("invalid-expected-archive-digest")
        allowlist = Allowlist(args.allowlist)
        findings = Findings(allowlist)
        result["policy"] = {
            "gitleaks_rules_sha256": digest_file(HERE / "gitleaks.toml"),
            "allowlist_sha256": digest_file(args.allowlist),
        }
        result["scanner_files"] = {
            str(p.relative_to(HERE)): digest_file(p)
            for p in [HERE / "scan-image-secrets.sh", HERE / "scan_image_secrets.py"]
            + sorted((HERE / "image_secrets").glob("*.py"))
        }
        with tempfile.TemporaryDirectory(prefix="image-secret-scan-", dir=args.tmpdir) as temporary:
            workspace = Path(temporary)
            backend = Gitleaks("gitleaks", HERE / "gitleaks.toml", workspace, args.timeout)
            result["gitleaks_version"] = backend.version
            candidate = Path(args.input)
            is_archive = args.input_kind == "archive" or (args.input_kind == "auto" and candidate.is_file())
            if is_archive:
                archive_path = candidate.resolve(strict=True)
                if not archive_path.is_file():
                    raise ScanError("archive-must-be-regular-file")
                result["input_kind"] = "archive"
            else:
                archive_path = workspace / "image.tar"
                result["resolved_local_image_id"] = image_export(args.input, archive_path, args.timeout)
                result["input_kind"] = "local-image"
            initial_digest = digest_file(archive_path)
            result["archive_sha256"] = initial_digest
            if args.expected_archive_sha256 and initial_digest != args.expected_archive_sha256:
                raise ScanError("archive-digest-mismatch")
            if shutil.disk_usage(workspace).free < 256 * 1024 * 1024:
                raise ScanError("insufficient-scratch-space")
            budget = Budget(args.max_bytes, args.max_entries)
            with ImageArchive(archive_path, workspace, budget, args.timeout) as archive:
                result["inventory"] = scan_archive(archive, backend, findings, workspace, budget, progress)
            if digest_file(archive_path) != initial_digest:
                raise ScanError("archive-changed-during-scan")
            result["scanned_bytes"] = budget.bytes
            result["complete"] = True
            result["status"] = "FINDINGS" if findings.items else "CLEAN"
    except (Exception, KeyboardInterrupt) as error:  # noqa: BLE001 -- fail closed and suppress unsafe error text
        # Third-party exceptions can contain image contents. Publish only our fixed identifiers.
        result["status"] = "ERROR"
        result["complete"] = False
        result["error"] = str(error) if isinstance(error, ScanError) else "scanner-operation-failed"
    if findings:
        result["findings"] = findings.safe_items(findings.items)
        result["allowlisted"] = findings.safe_items(findings.allowed)
    if result["complete"]:
        try:
            assess(result, args.blocking_rules, args.classifications)
        except (Exception, KeyboardInterrupt) as error:  # noqa: BLE001 -- never disclose packet values
            result["status"] = "ERROR"
            result["complete"] = False
            result["error"] = (
                str(error) if isinstance(error, ScanError) else "classification-operation-failed"
            )
    result["finished_at"] = now()
    result["exit_code"] = {"CLEAN": 0, "FINDINGS": 1, "ERROR": 2}[result["status"]]
    try:
        write_json(args.output / "REPORT.json", result)
        with (args.output / "REPORT.txt").open("x") as stream:
            stream.write(report_text(result))
    except OSError:
        print('{"status":"ERROR","error":"report-write-failed"}', file=sys.stderr)
        return 2
    print(
        json.dumps(
            {
                "status": result["status"],
                "exit_code": result["exit_code"],
                "findings": len(result["findings"]),
                "complete": result["complete"],
                "blocking_rules": result["blocking_rules"],
                "counts": result.get("counts"),
            }
        )
    )
    return result["exit_code"]


def interrupted(signum, frame):
    raise KeyboardInterrupt()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    sys.exit(main())
