"""Native job/artifact provenance must survive publish-only workflow retries."""

import copy
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

import staging_artifact
import unittest

from staging_artifact import producer_environment, select_artifact


class ArtifactSelectionTests(unittest.TestCase):
    def setUp(self):
        self.env = {"COMPONENT": "api", "GITHUB_REPOSITORY": "ChronoAIProject/Ornn",
                    "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2",
                    "GITHUB_SHA": "a" * 40, "GITHUB_REF": "refs/heads/develop",
                    "GITHUB_EVENT_NAME": "push"}
        self.run = {"repository": {"full_name": "ChronoAIProject/Ornn"},
                    "path": ".github/workflows/staging-native-images.yml", "id": 123,
                    "head_sha": "a" * 40, "event": "push", "run_attempt": 2}
        self.job = {"id": 456, "name": "image (api)", "status": "completed",
                    "conclusion": "success", "run_id": 123, "run_attempt": 1,
                    "head_sha": "a" * 40}
        self.artifact = {"id": 789, "name": "ornn-native-api-" + "a" * 40 + "-123-1",
                         "expired": False, "size_in_bytes": 2048, "digest": "sha256:" + "b" * 64,
                         "workflow_run": {"id": 123, "head_sha": "a" * 40}}

    def select(self, jobs=None, artifacts=None, env=None):
        return select_artifact(self.run, jobs or [self.job], artifacts or [self.artifact], env or self.env)

    def test_retry_uses_original_build_attempt_and_immutable_id(self):
        selection = self.select()
        self.assertEqual(selection["artifactId"], 789)
        self.assertEqual(selection["buildAttempt"], "1")
        self.assertEqual(selection["publicationAttempt"], "2")
        producing = producer_environment(self.env, selection)
        self.assertEqual(producing["GITHUB_RUN_ATTEMPT"], "1")
        self.assertEqual(self.env["GITHUB_RUN_ATTEMPT"], "2")

    def test_first_attempt_and_release_artifact(self):
        self.run.update(run_attempt=1, event="release")
        self.env.update(GITHUB_RUN_ATTEMPT="1", GITHUB_EVENT_NAME="release", GITHUB_REF="refs/tags/v1.2.3")
        self.assertEqual(self.select()["context"]["GITHUB_EVENT_NAME"], "release")

    def test_never_falls_back_to_another_artifact(self):
        for field, value in (("expired", True), ("name", "other"), ("size_in_bytes", 0),
                             ("digest", ""), ("id", -1)):
            artifact = dict(self.artifact, **{field: value})
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.select(artifacts=[artifact])
        with self.assertRaises(ValueError):
            self.select(artifacts=[self.artifact, self.artifact])

    def test_failed_foreign_or_future_build_is_rejected(self):
        for field, value in (("conclusion", "failure"), ("head_sha", "c" * 40),
                             ("run_id", 124), ("run_attempt", 3), ("name", "image (web)")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.select(jobs=[dict(self.job, **{field: value})])
        artifact = copy.deepcopy(self.artifact)
        artifact["workflow_run"]["id"] = 124
        with self.assertRaises(ValueError):
            self.select(artifacts=[artifact])
        self.run["head_sha"] = "c" * 40
        with self.assertRaises(ValueError):
            self.select()

    def test_selection_cannot_cross_execution_or_component(self):
        selection = self.select()
        for field, value in (("component", "web"), ("publicationAttempt", "3"), ("buildAttempt", "3")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                producer_environment(self.env, dict(selection, **{field: value}))
        with self.assertRaises(ValueError):
            producer_environment(dict(self.env, GITHUB_SHA="c" * 40), selection)

    def test_cli_selects_artifact_by_id_and_retains_attempts(self):
        with tempfile.TemporaryDirectory() as temp:
            prior = Path.cwd()
            try:
                os.chdir(temp)
                env = {**self.env, "GITHUB_OUTPUT": str(Path(temp) / "outputs")}
                with patch.dict(os.environ, env), patch.object(staging_artifact, 'github', side_effect=[
                        self.run, [{"jobs": [self.job]}], [{"artifacts": [self.artifact]}]]):
                    staging_artifact.main()
                self.assertEqual((Path(temp) / "outputs").read_text(), "artifact-id=789\n")
                self.assertEqual(json.loads(Path("staging-artifact.json").read_text())["buildAttempt"], "1")
            finally:
                os.chdir(prior)

    def test_github_transport_read_only_and_fails_closed(self):
        with patch.object(staging_artifact.subprocess, 'run', return_value=SimpleNamespace(
                returncode=0, stdout=b'[]')) as run:
            self.assertEqual(staging_artifact.github('route', pages=True), [])
            self.assertEqual(run.call_args.args[0],
                             ['gh', 'api', '--method', 'GET', 'route', '--paginate', '--slurp'])
        with patch.object(staging_artifact.subprocess, 'run', return_value=SimpleNamespace(returncode=1)):
            with self.assertRaises(ValueError):
                staging_artifact.github('route')


if __name__ == "__main__":
    unittest.main()
