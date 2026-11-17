"""Select the immutable artifact produced by this run's successful native job."""

import json
import os
from pathlib import Path
import re
import subprocess

REPOSITORY = "ChronoAIProject/Ornn"
WORKFLOW = ".github/workflows/staging-native-images.yml"
CONTEXT = ("GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_SHA", "GITHUB_REF", "GITHUB_EVENT_NAME")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def select_artifact(run, jobs, artifacts, env):
    component = env["COMPONENT"]
    require(component in ("api", "web") and env["GITHUB_REPOSITORY"] == REPOSITORY,
            "Unexpected artifact repository or component")
    require(run["repository"]["full_name"] == REPOSITORY and run["path"] == WORKFLOW,
            "Unexpected native workflow")
    require(str(run["id"]) == env["GITHUB_RUN_ID"] and run["head_sha"] == env["GITHUB_SHA"]
            and run["event"] == env["GITHUB_EVENT_NAME"]
            and str(run["run_attempt"]) == env["GITHUB_RUN_ATTEMPT"], "Run identity mismatch")
    matches = [job for job in jobs if job["name"] == f"image ({component})"]
    require(bool(matches) and all(type(job["run_attempt"]) is int
                                 and 0 < job["run_attempt"] <= int(env["GITHUB_RUN_ATTEMPT"])
                                 for job in matches), "Missing or invalid native job attempt")
    # Query all attempts because publish-only retries do not rerun successful builds.
    # Never fall back past a newer failed native job to an older successful artifact.
    newest = max(job["run_attempt"] for job in matches)
    matches = [job for job in matches if job["run_attempt"] == newest]
    require(len(matches) == 1, "Ambiguous native job")
    job = matches[0]
    require(job["status"] == "completed" and job["conclusion"] == "success",
            "Native build and scan must succeed")
    attempt = job["run_attempt"]
    require(type(attempt) is int and 0 < attempt <= int(env["GITHUB_RUN_ATTEMPT"]),
            "Invalid native producing attempt")
    require(str(job["run_id"]) == env["GITHUB_RUN_ID"] and job["head_sha"] == env["GITHUB_SHA"],
            "Native job belongs to a different source/run")
    name = f"ornn-native-{component}-{env['GITHUB_SHA']}-{env['GITHUB_RUN_ID']}-{attempt}"
    matches = [artifact for artifact in artifacts if artifact["name"] == name]
    require(len(matches) == 1, "Missing or ambiguous native artifact")
    artifact = matches[0]
    require(artifact["expired"] is False and artifact["size_in_bytes"] > 0,
            "Native artifact expired or empty; no rebuild fallback")
    require(type(artifact["id"]) is int and artifact["id"] > 0
            and re.fullmatch(r"sha256:[a-f0-9]{64}", artifact.get("digest", "")),
            "Missing immutable artifact identity")
    require(str(artifact["workflow_run"]["id"]) == env["GITHUB_RUN_ID"]
            and artifact["workflow_run"]["head_sha"] == env["GITHUB_SHA"],
            "Artifact belongs to a different source/run")
    return {
        "schema": "ornn-native-artifact-selection-v1", "component": component,
        "context": {key: env[key] for key in CONTEXT},
        "publicationAttempt": env["GITHUB_RUN_ATTEMPT"], "buildAttempt": str(attempt),
        "jobId": job["id"], "artifactId": artifact["id"], "artifactName": name,
        "artifactDigest": artifact["digest"],
    }


def producer_environment(env, selection):
    require(selection["schema"] == "ornn-native-artifact-selection-v1"
            and selection["component"] == env["COMPONENT"]
            and selection["context"] == {key: env[key] for key in CONTEXT}
            and selection["publicationAttempt"] == env["GITHUB_RUN_ATTEMPT"],
            "Artifact selection differs from publication execution")
    attempt = selection["buildAttempt"]
    require(re.fullmatch(r"[1-9][0-9]*", attempt)
            and int(attempt) <= int(env["GITHUB_RUN_ATTEMPT"]), "Invalid producing attempt")
    # Preserve the original artifact workflow identity in the existing receipt.
    # The separate selection receipt records this publication execution's attempt.
    return {**env, "GITHUB_RUN_ATTEMPT": attempt}


def github(route, pages=False):
    args = ["gh", "api", "--method", "GET", route]
    if pages:
        args += ["--paginate", "--slurp"]
    result = subprocess.run(args, capture_output=True, check=False, timeout=60)
    require(result.returncode == 0, "GitHub artifact lookup failed; raw response withheld")
    return json.loads(result.stdout)


def main():
    env = os.environ
    run_path = f"repos/{REPOSITORY}/actions/runs/{env['GITHUB_RUN_ID']}"
    run = github(run_path)
    job_pages = github(run_path + "/jobs?filter=all&per_page=100", pages=True)
    artifact_pages = github(run_path + "/artifacts?per_page=100", pages=True)
    selection = select_artifact(run, [j for page in job_pages for j in page["jobs"]],
                                [a for page in artifact_pages for a in page["artifacts"]], env)
    Path("staging-artifact.json").write_text(json.dumps(selection, indent=2) + "\n")
    with Path(env["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"artifact-id={selection['artifactId']}\n")
    print(f"Selected {env['COMPONENT']} artifact {selection['artifactId']} from build attempt "
          f"{selection['buildAttempt']} for publication attempt {selection['publicationAttempt']}")


if __name__ == "__main__":
    main()
