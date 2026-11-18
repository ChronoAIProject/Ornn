"""Outbound handoff tests with no network or registry writes."""
import contextlib
import hashlib
import io
import os
from pathlib import Path
import json
import subprocess
import unittest
from unittest.mock import Mock, patch

import staging_handoff

from staging_handoff import PACKAGE, REPOSITORY, dispatch, payload


class HandoffTests(unittest.TestCase):
    def test_workflow_masks_destination_before_runner_environment_logging(self):
        workflow = (Path(__file__).resolve().parents[2] /
                    ".github/workflows/staging-native-images.yml").read_text()
        handoff = workflow.split("      - name: Emit image publication handoff\n", 1)[1]
        self.assertIn("IMAGE_HANDOFF_REPOSITORY: ${{ secrets.IMAGE_HANDOFF_REPOSITORY }}", handoff)
        self.assertNotIn("vars.IMAGE_HANDOFF_REPOSITORY", workflow)
        self.assertIn("IMAGE_HANDOFF_ENABLED: ${{ vars.IMAGE_HANDOFF_ENABLED }}", handoff)
        self.assertIn("IMAGE_HANDOFF_TOKEN: ${{ secrets.IMAGE_HANDOFF_TOKEN }}", handoff)

    def setUp(self):
        self.env = {"GITHUB_REPOSITORY": REPOSITORY, "GITHUB_EVENT_NAME": "push",
                    "GITHUB_REF": "refs/heads/develop", "GITHUB_SHA": "a" * 40,
                    "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2", "COMPONENT": "api",
                    "IMAGE_HANDOFF_ENABLED": "true", "IMAGE_HANDOFF_REPOSITORY": "ChronoAIProject/example-consumer",
                    "IMAGE_HANDOFF_TOKEN": "synthetic-credential"}
        self.receipt = {"schema": "ornn-staging-publication-v1", "component": "api", "package": PACKAGE,
                        "manifestDigest": "sha256:" + "b" * 64, "tag": "a" * 40, "sourceRevision": "a" * 40,
                        "image": PACKAGE + "@sha256:" + "b" * 64,
                        "workflow": {"repository": REPOSITORY, "runId": "123", "runAttempt": "1",
                                     "ref": "refs/heads/develop", "event": "push"}}

    def raw(self):
        return json.dumps(self.receipt).encode()

    def test_payload_binds_exact_receipt_and_allows_build_attempt_reuse(self):
        actual = payload(self.raw(), self.env)
        self.assertEqual(actual["event_type"], "ornn-api-published")
        self.assertEqual(actual["client_payload"], {"schema": "ornn-image-handoff-v1", "repository": REPOSITORY,
            "source_sha": "a" * 40, "run_id": "123", "run_attempt": "2", "image": self.receipt["image"],
            "receipt_sha256": hashlib.sha256(self.raw()).hexdigest()})

    def test_non_develop_non_api_or_bad_source_cannot_dispatch(self):
        for key, value in [("GITHUB_REPOSITORY", "other/repo"), ("GITHUB_EVENT_NAME", "pull_request"),
                ("GITHUB_EVENT_NAME", "release"), ("GITHUB_EVENT_NAME", "workflow_dispatch"),
                ("GITHUB_REF", "refs/heads/main"), ("COMPONENT", "web"), ("GITHUB_SHA", "bad"),
                ("GITHUB_RUN_ID", "0"), ("GITHUB_RUN_ATTEMPT", "-1")]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                payload(self.raw(), {**self.env, key: value})

    def test_receipt_mismatches_fail(self):
        original = dict(self.receipt)
        for key, value in [("schema", "other"), ("component", "web"), ("package", PACKAGE + "-other"),
                ("manifestDigest", "tag"), ("image", PACKAGE + ":latest"), ("sourceRevision", "c" * 40),
                ("tag", "c" * 40), ("workflow", []), ("workflow", {})]:
            with self.subTest(key=key):
                self.receipt = {**original, key: value}
                with self.assertRaises(ValueError): payload(self.raw(), self.env)
        self.receipt = original
        for key, value in [("runId", "9"), ("runAttempt", "3"), ("runAttempt", "bad"), ("event", "release")]:
            self.receipt = {**original, "workflow": {**original["workflow"], key: value}}
            with self.subTest(key=key), self.assertRaises(ValueError): payload(self.raw(), self.env)
        for raw in [b"null", b"bad", b" " * 65537]:
            with self.assertRaises(ValueError): payload(raw, self.env)

    def test_disabled_is_default_and_never_calls_transport(self):
        remote = Mock()
        for enabled in [None, "false", "TRUE"]:
            env = dict(self.env); env.pop("IMAGE_HANDOFF_ENABLED")
            if enabled is not None: env["IMAGE_HANDOFF_ENABLED"] = enabled
            self.assertFalse(dispatch(b"not read", env, remote))
        remote.assert_not_called()

    def test_destination_and_credential_fail_before_transport(self):
        for key, value in [("IMAGE_HANDOFF_REPOSITORY", ""), ("IMAGE_HANDOFF_REPOSITORY", REPOSITORY),
                ("IMAGE_HANDOFF_REPOSITORY", "other/consumer"), ("IMAGE_HANDOFF_REPOSITORY", "ChronoAIProject/../x"),
                ("IMAGE_HANDOFF_TOKEN", ""), ("IMAGE_HANDOFF_TOKEN", "bad\nvalue")]:
            remote = Mock()
            with self.subTest(key=key), self.assertRaises(ValueError):
                dispatch(self.raw(), {**self.env, key: value}, remote)
            remote.assert_not_called()

    def test_dispatch_payload_stdin_secret_env_and_failure_no_retry(self):
        for code in [0, 1]:
            remote = Mock(return_value=subprocess.CompletedProcess([], code, b"private-output", b"private-error"))
            if code:
                with self.assertRaisesRegex(RuntimeError, "handoff failed") as error:
                    dispatch(self.raw(), self.env, remote)
                self.assertNotIn("private", str(error.exception))
            else:
                self.assertTrue(dispatch(self.raw(), self.env, remote))
            self.assertEqual(remote.call_count, 1)
            self.assertNotIn("synthetic-credential", repr(remote.call_args.args))
            self.assertNotIn("synthetic-credential", remote.call_args.kwargs["input"].decode())
            self.assertEqual(remote.call_args.kwargs["env"]["GH_TOKEN"], "synthetic-credential")
            self.assertEqual(json.loads(remote.call_args.kwargs["input"]), payload(self.raw(), self.env))


    def test_cli_disabled_success_missing_receipt_and_private_error_are_safe(self):
        with patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(staging_handoff.main(), 0)
        for error in [None, OSError("private destination"), RuntimeError("private destination")]:
            with patch.dict(os.environ, self.env, clear=True), patch.object(Path, "read_bytes", return_value=self.raw()), \
                    patch.object(staging_handoff, "dispatch", return_value=True, side_effect=error), \
                    contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(staging_handoff.main(), 0 if error is None else 1)
            self.assertNotIn("private destination", output.getvalue())


if __name__ == "__main__":
    unittest.main()
