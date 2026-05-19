"""CSV processor example skill.

Reads a CSV file path from `argv[1]`, computes per-column min/mean/max
for every column where at least one cell parses as a number, writes a
JSON summary to stdout. On any failure: `{ "error": "..." }` on stderr
+ exit code 1.

Stdlib only; deterministic; offline. The control case for debugging
agent ↔ skill plumbing.
"""

from __future__ import annotations

import csv
import json
import sys
from typing import Optional


def parse_number(raw: str) -> Optional[float]:
    """Best-effort numeric parse — empty / non-numeric returns None."""
    s = raw.strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def summarise(path: str) -> dict:
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        fieldnames = reader.fieldnames or []
        sums: dict[str, float] = {name: 0.0 for name in fieldnames}
        counts: dict[str, int] = {name: 0 for name in fieldnames}
        mins: dict[str, float] = {}
        maxs: dict[str, float] = {}
        row_count = 0

        for row in reader:
            row_count += 1
            for name in fieldnames:
                value = parse_number(row.get(name, ""))
                if value is None:
                    continue
                sums[name] += value
                counts[name] += 1
                if name not in mins or value < mins[name]:
                    mins[name] = value
                if name not in maxs or value > maxs[name]:
                    maxs[name] = value

        columns: dict[str, dict[str, float | int]] = {}
        for name in fieldnames:
            if counts[name] == 0:
                # Skip columns where no cell parsed as a number.
                continue
            columns[name] = {
                "min": mins[name],
                "mean": sums[name] / counts[name],
                "max": maxs[name],
                "count": counts[name],
            }

        return {"rowCount": row_count, "columns": columns}


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write(json.dumps({"error": "usage: main.py <path>"}) + "\n")
        return 1
    try:
        result = summarise(argv[1])
    except FileNotFoundError as e:
        sys.stderr.write(json.dumps({"error": f"file not found: {e.filename}"}) + "\n")
        return 1
    except OSError as e:
        sys.stderr.write(json.dumps({"error": f"could not read CSV: {e}"}) + "\n")
        return 1
    sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
