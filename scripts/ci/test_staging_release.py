import copy
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from staging_image import guard
from staging_release import validate_release, verify_release_source


class ReleasePublicationTests(unittest.TestCase):
    def setUp(self):
        self.env = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "ChronoAIProject/Ornn",
                    "COMPONENT": "api", "RUNNER_ARCH": "X64", "GITHUB_SHA": "a" * 40,
                    "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1",
                    "GITHUB_EVENT_NAME": "release", "GITHUB_REF": "refs/tags/v1.2.3"}
        self.event = {"action": "published", "release": {"tag_name": "v1.2.3", "draft": False}}

    def test_published_release_builds_and_publishes(self):
        for mode in ("build", "publish"):
            guard(self.env, mode, "x86_64", self.env["GITHUB_SHA"], self.event)
        run = Mock(side_effect=[SimpleNamespace(returncode=0, stdout="a" * 40 + "\n"),
                                SimpleNamespace(returncode=0)])
        verify_release_source(self.env, self.event, run)
        self.assertEqual(run.call_args.args[0][-1], "refs/remotes/origin/main")

    def test_draft_edited_mismatched_or_unsafe_tag_is_refused(self):
        cases = []
        for field, value in (("draft", True), ("tag_name", "main"),
                             ("tag_name", "v1.2.3;echo"), ("tag_name", "v1.2.4")):
            event = copy.deepcopy(self.event)
            event["release"][field] = value
            cases.append(event)
        cases.append(dict(self.event, action="edited"))
        for event in cases:
            with self.subTest(event=event), self.assertRaises(ValueError):
                validate_release(self.env, event)
        with self.assertRaises(ValueError):
            guard(dict(self.env, GITHUB_REPOSITORY="other/repo"), "publish", "x86_64",
                  self.env["GITHUB_SHA"], self.event)

    def test_wrong_tag_commit_or_non_main_source_fails_closed(self):
        for results in ([SimpleNamespace(returncode=1, stdout="")],
                        [SimpleNamespace(returncode=0, stdout="b" * 40)],
                        [SimpleNamespace(returncode=0, stdout="a" * 40), SimpleNamespace(returncode=1)]):
            with self.assertRaises(ValueError):
                verify_release_source(self.env, self.event, Mock(side_effect=results))


if __name__ == "__main__":
    unittest.main()
