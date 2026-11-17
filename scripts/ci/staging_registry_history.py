"""GHCR version/tag snapshots detect observable interference, not atomic writes.

GitHub exposes package versions, current tags and update times, not an immutable
history of every tag assignment. Unobserved/interleaved external writes remain a
registry limitation even when both snapshots and remote identity checks agree.
An external write after the final lookup and before crane finishes uploading blobs
and assigning the tag can still be overwritten. Identical
digest writes, updates within timestamp precision, deleted competing versions and
metadata propagation delays may hide interference. A later writer can also change
the tag after verification. Coordinate external pushes; deployment uses digests.
"""

from datetime import datetime
import hashlib
import json
import re
import subprocess

from staging_image import require

DIGEST = r"sha256:[a-f0-9]{64}"
TARGET = r"ghcr\.io/chronoaiproject/(ornn-(?:api|web)):([a-f0-9]{40})"


def parse_versions(pages):
    require(isinstance(pages, list) and bool(pages), "Missing package history pages")
    versions, digests = {}, set()
    try:
        for page in pages:
            require(isinstance(page, list), "Invalid package history page")
            for item in page:
                version_id, digest = item["id"], item["name"]
                require(type(version_id) is int and version_id > 0
                        and version_id not in versions, "Invalid or repeated package version")
                require(isinstance(digest, str) and re.fullmatch(DIGEST, digest)
                        and digest not in digests, "Invalid or repeated package digest")
                created, updated = item["created_at"], item["updated_at"]
                for value in (created, updated):
                    require(isinstance(value, str)
                            and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value),
                            "Invalid package history timestamp")
                    datetime.fromisoformat(value.replace("Z", "+00:00"))
                require(created <= updated, "Package history timestamp moved backwards")
                tags = item["metadata"]["container"]["tags"]
                require(isinstance(tags, list) and all(isinstance(tag, str)
                        and re.fullmatch(r"[\w][\w.-]{0,127}", tag, flags=re.ASCII)
                        for tag in tags) and len(set(tags)) == len(tags),
                        "Invalid package history tags")
                versions[version_id] = {"digest": digest, "created": created,
                                        "updated": updated, "tags": sorted(tags)}
                digests.add(digest)
    except (KeyError, TypeError, ValueError):
        raise ValueError("Invalid package history; raw response withheld") from None
    return versions


class GithubPackageHistory:
    def __init__(self, run=subprocess.run):
        self.run = run

    def snapshot(self, target):
        match = re.fullmatch(TARGET, target)
        require(match is not None, "Unexpected package history target")
        route = f"orgs/ChronoAIProject/packages/container/{match[1]}/versions?per_page=100"
        result = self.run(["gh", "api", "--method", "GET", route, "--paginate", "--slurp"],
                          capture_output=True, check=False, timeout=120)
        require(result.returncode == 0, "Package history read failed; raw response withheld")
        require(len(result.stdout) <= 32 * 1024 * 1024, "Package history exceeds size limit")
        try:
            pages = json.loads(result.stdout)
        except (ValueError, UnicodeError, RecursionError):
            raise ValueError("Invalid package history JSON; raw response withheld") from None
        return parse_versions(pages)


def verify_history(before, after, target, digest, action):
    """Only the expected manifest's own source-tag attachment may change.

    Other package versions changing is conservative evidence of another writer,
    including a competing version left untagged after our push overwrote its tag.
    Missing/stale metadata fails closed; do not call the snapshots a full audit log.
    """
    tag = target.rsplit(":", 1)[1]
    expected_ids = [key for key, value in after.items() if value["digest"] == digest]
    require(len(expected_ids) == 1, "Expected package version absent from history")
    expected_id = expected_ids[0]
    require([key for key, value in after.items() if tag in value["tags"]] == [expected_id],
            "Package history source tag differs from scanned image")
    if action == "reused":
        require(before == after, "Package history changed during tag reuse; possible other writer")
        return
    require(action == "published", "Invalid publication action")
    require(all(tag not in value["tags"] for value in before.values()),
            "Package history already assigns source tag; refusing publication")
    for key in before.keys() | after.keys():
        if key != expected_id:
            require(key in before and key in after and before[key] == after[key],
                    "Package history shows another writer or deletion")
    expected = after[expected_id]
    previous = before.get(expected_id)
    if previous is None:
        require(expected["tags"] == [tag], "New version has unexpected tags; possible other writer")
    else:
        require(previous["digest"] == expected["digest"]
                and previous["created"] == expected["created"]
                and previous["updated"] <= expected["updated"]
                and expected["tags"] == sorted(previous["tags"] + [tag]),
                "Existing version changed unexpectedly; possible other writer")


def history_hash(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
