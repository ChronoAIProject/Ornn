"""Qualification sharding must keep complete discovery and a failing join."""
import re
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

import staging_gate_shards as shards


class SyntheticCase(unittest.TestCase):
    def __init__(self, identifier):
        super().__init__()
        self.identifier = identifier

    def id(self):
        return self.identifier

    def runTest(self):
        pass


class GateShardTests(unittest.TestCase):
    def suite(self, *ids):
        return unittest.TestSuite([unittest.TestSuite([SyntheticCase(value)]) for value in ids])

    def test_all_discovered_tests_are_assigned_once_including_new_methods(self):
        groups = {"scanner-a": ("test_a",), "scanner-b": ("test_b",)}
        suite = self.suite("test_a.Check.test_one", "test_a.Check.test_new", "test_b.Check.test_one")
        result = shards.partition(suite, groups)
        self.assertEqual([case.id() for case in shards.cases(result["scanner-a"])],
                         ["test_a.Check.test_one", "test_a.Check.test_new"])
        self.assertEqual(result["scanner-b"].countTestCases(), 1)

    def test_missing_duplicate_stale_or_empty_assignments_fail_closed(self):
        ids = ("test_a.Check.test_one", "test_b.Check.test_one")
        for groups in [
            {"scanner-a": ("test_a",), "scanner-b": ("test_a",)},
            {"scanner-a": ("test_a", "test_a"), "scanner-b": ("test_b",)},
            {"scanner-a": ("test_a",), "scanner-b": ("test_missing",)},
            {"scanner-a": ("test_a", "test_b"), "scanner-b": ()},
            {"scanner-a": ("test_a", "test_b")},
        ]:
            with self.subTest(groups=groups), self.assertRaises(ValueError):
                shards.partition(self.suite(*ids), groups)
        valid = {"scanner-a": ("test_a",), "scanner-b": ("test_b",)}
        for invalid_ids in [(), (*ids, ids[0]), (*ids, "test_new.Check.test_one")]:
            with self.subTest(ids=invalid_ids), self.assertRaises(ValueError):
                shards.partition(self.suite(*invalid_ids), valid)

    def test_import_error_never_runs_a_partial_discovery(self):
        loader = Mock(errors=["synthetic import failure"])
        with patch.object(shards.os, "chdir"), patch.object(shards.sys, "path", []), \
                patch.object(shards.unittest, "TestLoader", return_value=loader), \
                patch.object(shards, "partition") as partition:
            with self.assertRaisesRegex(ValueError, "discovery failed"):
                shards.discover_scanner()
            partition.assert_not_called()

    def test_scanner_execution_preserves_failures_and_runs_only_selected_suite(self):
        for successful in (True, False):
            selected = self.suite("test_a.Check.test_one")
            other = self.suite("test_b.Check.test_one")
            runner = Mock(); runner.run.return_value.wasSuccessful.return_value = successful
            with patch.object(shards, "discover_scanner", return_value={"scanner-a": selected, "scanner-b": other}), \
                    patch.object(shards.unittest, "TextTestRunner", return_value=runner), patch("builtins.print"):
                self.assertEqual(shards.run("scanner-a"), 0 if successful else 1)
                runner.run.assert_called_once_with(selected)

    def test_complete_other_suites_keep_environment_and_failure_exit_codes(self):
        for name in ("acceptance", "content-policy"):
            with patch.object(shards.subprocess, "run", return_value=Mock(returncode=7)) as execute:
                self.assertEqual(shards.run(name), 7)
                args, kwargs = execute.call_args
                self.assertEqual(args[0][:2], [sys.executable, "-B"])
                self.assertEqual(kwargs["cwd"], shards.ROOT)
                self.assertFalse(kwargs["check"])
                if name == "content-policy":
                    self.assertEqual(kwargs["env"]["TEST_SCANNER"], str(shards.SCANNER))
                    self.assertEqual(args[0][2:], ["-m", "unittest", "discover", "-s",
                                                  "scripts/ci/content-policy/tests", "-v"])
                else:
                    self.assertEqual(args[0][2:], ["scripts/ci/test_shared_image_gate.py", "-v"])
        with self.assertRaises(ValueError):
            shards.run("unknown")

    def test_cli_selects_exact_suite_and_private_temporary_permissions(self):
        with patch.object(shards.os, "umask") as umask, patch.object(shards, "run", return_value=1) as run:
            self.assertEqual(shards.main(["scanner-b"]), 1)
            umask.assert_called_once_with(0o077)
            run.assert_called_once_with("scanner-b")

    def test_workflow_requires_all_four_jobs_and_preserves_required_names(self):
        workflow = (shards.ROOT / ".github/workflows/staging-native-images.yml").read_text()
        def job(name):
            return re.split(r"\n  [a-z_]+:\n", workflow.split("\n  " + name + ":\n", 1)[1], 1)[0]
        matrix = job("gate_shards")
        self.assertIn("suite: [scanner-a, scanner-b, acceptance, content-policy]", matrix)
        self.assertIn("fail-fast: false", matrix)
        self.assertIn("runs-on: ubuntu-24.04", matrix)
        self.assertNotIn("continue-on-error", matrix)
        aggregate = job("gate_tests")
        self.assertIn("always() &&", aggregate)
        self.assertIn("needs: [gate_shards]", aggregate)
        self.assertIn("SHARD_RESULT: ${{ needs.gate_shards.result }}", aggregate)
        command = re.search(r"run: \|\n((?:          .*\n)+)", aggregate)[1]
        command = "\n".join(line[10:] for line in command.splitlines())
        for state in ("success", "failure", "cancelled", "skipped", ""):
            result = subprocess.run(["bash", "-c", command], env={"SHARD_RESULT": state},
                                    capture_output=True, check=False)
            self.assertEqual(result.returncode == 0, state == "success")
        for component in ("api", "web"):
            self.assertIn("needs: [image_" + component + ", gate_tests]", job("publish_" + component))
            self.assertIn("name: image (" + component + ")", job("image_" + component))


if __name__ == "__main__":
    unittest.main()
