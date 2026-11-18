"""Emit a public image receipt reference; deployment details stay with the consumer."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

REPOSITORY = "ChronoAIProject/Ornn"
PACKAGE = "ghcr.io/chronoaiproject/ornn-api"


def require(value):
    if not value:
        raise ValueError("Invalid publication handoff")


def payload(raw, env):
    require(env.get("GITHUB_REPOSITORY") == REPOSITORY)
    require(env.get("GITHUB_EVENT_NAME") == "push" and env.get("GITHUB_REF") == "refs/heads/develop")
    require(env.get("COMPONENT") == "api")
    sha = env.get("GITHUB_SHA", "")
    run, attempt = env.get("GITHUB_RUN_ID", ""), env.get("GITHUB_RUN_ATTEMPT", "")
    require(re.fullmatch(r"[0-9a-f]{40}", sha))
    require(re.fullmatch(r"[1-9][0-9]*", run) and re.fullmatch(r"[1-9][0-9]*", attempt))
    require(len(raw) <= 65536)
    receipt = json.loads(raw)
    require(isinstance(receipt, dict))
    digest = receipt.get("manifestDigest", "")
    require(isinstance(digest, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", digest))
    require(receipt.get("schema") == "ornn-staging-publication-v1")
    require(receipt.get("component") == "api" and receipt.get("package") == PACKAGE)
    require(receipt.get("tag") == sha and receipt.get("sourceRevision") == sha)
    require(receipt.get("image") == PACKAGE + "@" + digest)
    workflow = receipt.get("workflow", {})
    require(isinstance(workflow, dict))
    require(all(workflow.get(k) == v for k, v in {
        "repository": REPOSITORY, "runId": run, "event": "push", "ref": "refs/heads/develop"}.items()))
    # Publish-only retries may reuse an earlier successful build attempt.
    build_attempt = workflow.get("runAttempt", "")
    require(isinstance(build_attempt, str) and re.fullmatch(r"[1-9][0-9]*", build_attempt))
    require(int(build_attempt) <= int(attempt))
    return {"event_type": "ornn-api-published", "client_payload": {
        "schema": "ornn-image-handoff-v1", "repository": REPOSITORY,
        "source_sha": sha, "run_id": run, "run_attempt": attempt,
        "image": receipt["image"], "receipt_sha256": hashlib.sha256(raw).hexdigest(),
    }}


def dispatch(raw, env, run=subprocess.run):
    if env.get("IMAGE_HANDOFF_ENABLED", "false") != "true":
        return False
    body = payload(raw, env)
    destination = env.get("IMAGE_HANDOFF_REPOSITORY", "")
    require(re.fullmatch(r"ChronoAIProject/[A-Za-z0-9_.-]+", destination))
    require(destination != REPOSITORY)
    token = env.get("IMAGE_HANDOFF_TOKEN", "")
    require(bool(token) and not any(c.isspace() for c in token))
    child = {k: v for k, v in env.items() if k not in {"IMAGE_HANDOFF_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"}}
    child["GH_TOKEN"] = token
    result = run(["gh", "api", "--hostname", "github.com", "--method", "POST",
                  "repos/" + destination + "/dispatches", "--input", "-"],
                 input=json.dumps(body).encode(), capture_output=True, timeout=30, env=child)
    # The response may identify a private consumer. Never echo it into public logs.
    if result.returncode:
        raise RuntimeError("Publication handoff failed; no retry performed")
    return True


def main():
    try:
        if os.environ.get("IMAGE_HANDOFF_ENABLED", "false") != "true":
            print("Image handoff disabled")
            return 0
        sent = dispatch(Path("staging-image-out/publication.json").read_bytes(), os.environ)
        print("Image handoff accepted" if sent else "Image handoff disabled")
        return 0
    except (ValueError, TypeError, OSError, RuntimeError, subprocess.TimeoutExpired):
        print("::error::Image publication handoff failed; publication receipt remains available")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
