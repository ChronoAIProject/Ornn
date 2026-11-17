"""Native job/artifact provenance must survive publish-only workflow retries."""

import copy
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


if __name__ == "__main__":
    unittest.main()
