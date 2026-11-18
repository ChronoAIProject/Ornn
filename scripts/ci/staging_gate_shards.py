"""Run every scanner qualification test in isolated, exhaustive CI shards."""
import argparse
from collections import Counter
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCANNER = ROOT / "scripts/ci/image-secret-scan"
SCANNER_GROUPS = {
    "scanner-a": ("test_policy_a", "test_cache", "test_artifacts", "test_allowlist_v2"),
    "scanner-b": ("test_scanner", "test_review_regressions", "test_zip_probe", "test_boundaries"),
}
SUITES = (*SCANNER_GROUPS, "acceptance", "content-policy")


def cases(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from cases(item)
        else:
            yield item


def partition(suite, groups=SCANNER_GROUPS):
    discovered = list(cases(suite))
    ids = [case.id() for case in discovered]
    modules = {test_id.split(".", 1)[0] for test_id in ids}
    assigned_modules = [module for group in groups.values() for module in group]
    if (set(groups) != set(SCANNER_GROUPS) or not ids or len(ids) != len(set(ids))
            or any(not group for group in groups.values())
            or Counter(assigned_modules) != Counter({module: 1 for module in modules})):
        raise ValueError("scanner shard coverage differs from discovery")
    shards = {name: [case for case in discovered if case.id().split(".", 1)[0] in group]
              for name, group in groups.items()}
    assigned_ids = [case.id() for shard in shards.values() for case in shard]
    if Counter(assigned_ids) != Counter(ids) or any(not shard for shard in shards.values()):
        raise ValueError("scanner tests are missing or duplicated across shards")
    return {name: unittest.TestSuite(shard) for name, shard in shards.items()}


def discover_scanner():
    # Match the vendored self-test's working directory and import context.
    os.chdir(SCANNER)
    sys.path.insert(0, str(SCANNER))
    loader = unittest.TestLoader()
    suite = loader.discover(str(SCANNER / "tests"))
    if loader.errors:
        raise ValueError("scanner test discovery failed")
    return partition(suite)


def run(name):
    if name in SCANNER_GROUPS:
        shards = discover_scanner()
        counts = {key: suite.countTestCases() for key, suite in shards.items()}
        print("PASS exact scanner discovery coverage: " + str(counts), flush=True)
        return 0 if unittest.TextTestRunner(verbosity=2).run(shards[name]).wasSuccessful() else 1
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    if name == "acceptance":
        command = [sys.executable, "-B", "scripts/ci/test_shared_image_gate.py", "-v"]
    elif name == "content-policy":
        command = [sys.executable, "-B", "-m", "unittest", "discover", "-s",
                   "scripts/ci/content-policy/tests", "-v"]
        environment["TEST_SCANNER"] = str(SCANNER)
    else:
        raise ValueError("unknown qualification suite")
    return subprocess.run(command, cwd=ROOT, env=environment, check=False).returncode


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suite", choices=SUITES)
    args = parser.parse_args(argv)
    os.umask(0o077)
    return run(args.suite)


if __name__ == "__main__":
    raise SystemExit(main())
