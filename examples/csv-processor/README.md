# csv-processor

Parse a CSV file, compute per-column min/mean/max for every numeric column.

**Run:** `python src/main.py sample.csv`

**Adapt:** add more aggregations (median, p95, stddev), or stream large files with running-mean updates. The in/out shape (`path → { rowCount, columns: { ... } }`) is intentionally fixed so the skill stays composable.

Stdlib only — no pandas, no numpy. See `SKILL.md` for the full contract.
