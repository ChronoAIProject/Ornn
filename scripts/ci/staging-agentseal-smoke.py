"""Exercise the installed skill scanner without network or application secrets."""

import json
from pathlib import Path
import subprocess
import tempfile
import zipfile


with tempfile.TemporaryDirectory(prefix="ornn-skill-smoke-") as temp:
    archive = Path(temp) / "skill.zip"
    with zipfile.ZipFile(archive, "w") as target:
        target.writestr("SKILL.md", "# Packaging smoke\nSummarize a local text file.\n")
    command = ["/opt/agentseal/bin/python", "/opt/agentseal/scan_skill.py", str(archive)]
    result = subprocess.run(command, capture_output=True, check=False, timeout=30)
    if result.returncode:
        raise RuntimeError("Installed skill scanner rejected the valid smoke archive")
    report = json.loads(result.stdout)
    if (not isinstance(report.get("score"), (int, float))
            or report.get("scannedFiles") != 1
            or report.get("agentsealVersion") != "agentseal-0.9.6"):
        raise RuntimeError("Installed skill scanner returned an invalid smoke result")
    archive.write_bytes(b"invalid archive")
    result = subprocess.run(command, capture_output=True, check=False, timeout=30)
    if result.returncode == 0:
        raise RuntimeError("Installed skill scanner accepted an invalid archive")
print("Passed installed AgentSeal success and failure smoke checks")
