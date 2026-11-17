"""Only a published version tag on main may use the release publication route."""

import re
import subprocess


def validate_release(env, event):
    release = (event or {}).get("release", {})
    tag = release.get("tag_name", "")
    if not ((event or {}).get("action") == "published"
            and release.get("draft") is False
            and re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", tag)
            and env.get("GITHUB_REF") == "refs/tags/" + tag):
        raise ValueError("Requires a published version-tag release")
    return tag


def verify_release_source(env, event, run=subprocess.run):
    tag = validate_release(env, event)
    resolved = run(["git", "rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}"],
                   capture_output=True, text=True, check=False)
    if resolved.returncode or resolved.stdout.strip() != env["GITHUB_SHA"]:
        raise ValueError("Release tag differs from the checked-out source")
    ancestor = run(["git", "merge-base", "--is-ancestor", env["GITHUB_SHA"],
                    "refs/remotes/origin/main"], capture_output=True, check=False)
    if ancestor.returncode:
        raise ValueError("Release source must be on main")
