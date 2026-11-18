"""Restore bounded scan-result artifacts only from authenticated develop producers.

No PR cache, branch prefix fallback, arbitrary archive extraction, image content
or detector secret is accepted. A miss always leaves the full scanner enabled.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import time
import zipfile

REPO = "ChronoAIProject/Ornn"
WORKFLOW = ".github/workflows/staging-native-images.yml"
MAX_BYTES = 64 * 1024 * 1024


def require(condition):
    if not condition:
        raise ValueError("Detector cache provenance refused")


def context(env):
    require(env.get("GITHUB_REPOSITORY") == REPO and env.get("GITHUB_EVENT_NAME") == "push"
            and env.get("GITHUB_REF") == "refs/heads/develop" and env.get("COMPONENT") in {"api", "web"})
    for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        require(re.fullmatch(r"[1-9][0-9]*", env.get(key, "")))


def github(path, binary=False):
    require(path.startswith("repos/" + REPO + "/") and ".." not in path)
    result = subprocess.run(["gh", "api", "--hostname", "github.com", "--method", "GET", path],
                            capture_output=True, timeout=10)
    require(result.returncode == 0 and len(result.stdout) <= MAX_BYTES)
    return result.stdout if binary else json.loads(result.stdout)


def validate_producer(run, jobs, artifact, component):
    require(run.get("repository", {}).get("full_name") == REPO
            and run.get("head_repository", {}).get("full_name") == REPO
            and run.get("path") == WORKFLOW and run.get("event") == "push"
            and run.get("head_branch") == "develop" and run.get("status") == "completed")
    sha, run_id, attempt = run.get("head_sha"), run.get("id"), run.get("run_attempt")
    require(isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha)
            and type(run_id) is int and run_id > 0 and type(attempt) is int and attempt > 0)
    require(isinstance(jobs.get("jobs"), list) and jobs.get("total_count") == len(jobs["jobs"]))
    for name in ("gate_tests", f"image ({component})"):
        matches = [j for j in jobs["jobs"] if j.get("name") == name]
        require(len(matches) == 1 and matches[0].get("conclusion") == "success"
                and matches[0].get("status") == "completed"
                and matches[0].get("head_sha") == sha and matches[0].get("run_id") == run_id
                and matches[0].get("run_attempt") == attempt)
    require(artifact.get("name") == f"ornn-detector-{component}-{run_id}-{attempt}"
            and artifact.get("expired") is False and type(artifact.get("id")) is int
            and artifact["id"] > 0 and type(artifact.get("size_in_bytes")) is int
            and 0 < artifact["size_in_bytes"] <= MAX_BYTES
            and artifact.get("workflow_run", {}).get("id") == run_id
            and artifact.get("workflow_run", {}).get("head_sha") == sha
            and isinstance(artifact.get("digest"), str)
            and re.fullmatch(r"sha256:[0-9a-f]{64}", artifact["digest"]))


def unpack(raw, artifact):
    require("sha256:" + hashlib.sha256(raw).hexdigest() == artifact["digest"])
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(archive.namelist() == ["detector-cache.json"])
        info = archive.getinfo("detector-cache.json")
        require(0 < info.file_size <= MAX_BYTES and not info.flag_bits & 1)
        data = archive.read(info)
    # Scanner validates every row and exact detector identity before using it.
    require(isinstance(json.loads(data), dict))
    return data


def restore(env, get, destination):
    context(env)
    require(not destination.exists())
    deadline = time.monotonic() + 30
    listing = get(f"repos/{REPO}/actions/workflows/staging-native-images.yml/runs?branch=develop&event=push&status=completed&per_page=10")
    require(isinstance(listing.get("workflow_runs"), list))
    for run in listing["workflow_runs"][:5]:
        if time.monotonic() >= deadline:
            break
        if str(run.get("id")) == env["GITHUB_RUN_ID"]:
            continue
        try:
            run_id, attempt = run["id"], run["run_attempt"]
            require(type(run_id) is int and type(attempt) is int and run_id > 0 and attempt > 0)
            prefix = f"repos/{REPO}/actions/runs/{run_id}"
            artifacts = get(prefix + "/artifacts?per_page=100")
            require(isinstance(artifacts.get("artifacts"), list)
                    and artifacts.get("total_count") == len(artifacts["artifacts"]))
            name = f"ornn-detector-{env['COMPONENT']}-{run_id}-{attempt}"
            matches = [a for a in artifacts["artifacts"] if a.get("name") == name]
            if not matches:
                continue
            require(len(matches) == 1)
            require(time.monotonic() < deadline)
            jobs = get(prefix + f"/attempts/{attempt}/jobs?per_page=100")
            validate_producer(run, jobs, matches[0], env["COMPONENT"])
            require(time.monotonic() < deadline)
            raw = get(f"repos/{REPO}/actions/artifacts/{matches[0]['id']}/zip", binary=True)
            data = unpack(raw, matches[0])
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("xb") as stream:
                stream.write(data)
            return {"status": "RESTORED", "producer_run": run_id, "producer_attempt": attempt,
                    "artifact_id": matches[0]["id"], "artifact_digest": matches[0]["digest"]}
        except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, zipfile.BadZipFile):
            continue
    return {"status": "MISS_FULL_SCAN"}


def main():
    destination = Path(os.environ["RUNNER_TEMP"]) / "ornn-detector-input.json"
    try:
        result = restore(os.environ, github, destination)
    except Exception:
        destination.unlink(missing_ok=True)
        result = {"status": "UNAVAILABLE_FULL_SCAN"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
