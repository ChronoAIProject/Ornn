"""Web handoffs are independently enabled and bound to their own publication."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock, patch

import staging_handoff


class WebHandoffTests(unittest.TestCase):
    def setUp(self):
        self.env = {
            "GITHUB_REPOSITORY": "ChronoAIProject/Ornn", "GITHUB_EVENT_NAME": "push",
            "GITHUB_REF": "refs/heads/develop", "GITHUB_SHA": "a" * 40,
            "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2", "COMPONENT": "web",
            "IMAGE_HANDOFF_WEB_ENABLED": "true",
            "IMAGE_HANDOFF_REPOSITORY": "ChronoAIProject/example-consumer",
            "IMAGE_HANDOFF_TOKEN": "synthetic-credential",
        }
        self.receipt = {
            "schema": "ornn-staging-publication-v1", "component": "web",
            "package": "ghcr.io/chronoaiproject/ornn-web", "manifestDigest": "sha256:" + "b" * 64,
            "tag": "a" * 40, "sourceRevision": "a" * 40,
            "image": "ghcr.io/chronoaiproject/ornn-web@sha256:" + "b" * 64,
            "workflow": {"repository": "ChronoAIProject/Ornn", "runId": "123", "runAttempt": "1",
                         "ref": "refs/heads/develop", "event": "push"},
        }

    def raw(self, **changes):
        return json.dumps({**self.receipt, **changes}).encode()

    def test_web_event_preserves_exact_seven_field_provenance_contract(self):
        raw = self.raw()
        body = staging_handoff.payload(raw, self.env)
        self.assertEqual(body, {
            "event_type": "ornn-web-published",
            "client_payload": {
                "schema": "ornn-image-handoff-v1", "repository": "ChronoAIProject/Ornn",
                "source_sha": "a" * 40, "run_id": "123", "run_attempt": "2",
                "image": self.receipt["image"], "receipt_sha256": hashlib.sha256(raw).hexdigest(),
            },
        })

    def test_api_and_web_switches_are_independent(self):
        for component in ["api", "web"]:
            for api in ["true", "false"]:
                for web in ["true", "false"]:
                    env = {**self.env, "COMPONENT": component,
                           "IMAGE_HANDOFF_ENABLED": api, "IMAGE_HANDOFF_WEB_ENABLED": web}
                    with self.subTest(component=component, api=api, web=web):
                        self.assertEqual(staging_handoff.enabled(env),
                                         (api if component == "api" else web) == "true")

    def test_api_enablement_does_not_read_or_dispatch_a_disabled_web_receipt(self):
        for value in [None, "false", "TRUE", "", "1"]:
            env = {**self.env, "IMAGE_HANDOFF_ENABLED": "true"}
            env.pop("IMAGE_HANDOFF_WEB_ENABLED")
            if value is not None:
                env["IMAGE_HANDOFF_WEB_ENABLED"] = value
            remote = Mock()
            with self.subTest(value=value), patch.dict(os.environ, env, clear=True), \
                    patch.object(Path, "read_bytes") as read, contextlib.redirect_stdout(io.StringIO()):
                self.assertFalse(staging_handoff.dispatch(b"invalid", env, remote))
                self.assertEqual(staging_handoff.main(), 0)
            remote.assert_not_called()
            read.assert_not_called()

    def test_mismatched_component_package_or_image_never_reaches_transport(self):
        cases = [
            {"component": "api"}, {"package": "ghcr.io/chronoaiproject/ornn-api"},
            {"image": "ghcr.io/chronoaiproject/ornn-api@sha256:" + "b" * 64},
            {"component": "api", "package": "ghcr.io/chronoaiproject/ornn-api",
             "image": "ghcr.io/chronoaiproject/ornn-api@sha256:" + "b" * 64},
            {"image": "ghcr.io/chronoaiproject/ornn-web:latest"},
        ]
        for changes in cases:
            remote = Mock()
            with self.subTest(fields=sorted(changes)), self.assertRaises(ValueError):
                staging_handoff.dispatch(self.raw(**changes), self.env, remote)
            remote.assert_not_called()
        remote = Mock()
        with self.assertRaises(ValueError):
            staging_handoff.dispatch(self.raw(), {**self.env, "COMPONENT": "api",
                                     "IMAGE_HANDOFF_ENABLED": "true"}, remote)
        remote.assert_not_called()

    def test_invalid_web_source_and_unsupported_component_refuse_before_transport(self):
        for key, value in [
            ("GITHUB_REPOSITORY", "other/repo"), ("GITHUB_EVENT_NAME", "pull_request"),
            ("GITHUB_EVENT_NAME", "release"), ("GITHUB_EVENT_NAME", "workflow_dispatch"),
            ("GITHUB_REF", "refs/heads/main"), ("GITHUB_SHA", "bad"),
            ("COMPONENT", "other"), ("COMPONENT", ""),
        ]:
            remote = Mock()
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                staging_handoff.dispatch(self.raw(), {**self.env, key: value}, remote)
            remote.assert_not_called()

    def test_invalid_web_receipt_and_run_attempt_refuse_before_transport(self):
        cases = [b"null", b"invalid", b" " * 65537,
                 self.raw(schema="other"), self.raw(manifestDigest="tag"),
                 self.raw(tag="c" * 40), self.raw(sourceRevision="c" * 40)]
        for key, value in [("repository", "other/repo"), ("runId", "9"), ("runAttempt", "3"),
                           ("runAttempt", "bad"), ("event", "release"), ("ref", "refs/heads/main")]:
            cases.append(self.raw(workflow={**self.receipt["workflow"], key: value}))
        for index, raw in enumerate(cases):
            remote = Mock()
            with self.subTest(case=index), self.assertRaises(ValueError):
                staging_handoff.dispatch(raw, self.env, remote)
            remote.assert_not_called()

    def test_web_transport_uses_stdin_once_and_does_not_leak_private_responses(self):
        for code in [0, 1]:
            remote = Mock(return_value=subprocess.CompletedProcess([], code, b"private-response", b"private-error"))
            output = io.StringIO()
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                if code:
                    with self.assertRaisesRegex(RuntimeError, "handoff failed") as caught:
                        staging_handoff.dispatch(self.raw(), self.env, remote)
                    self.assertNotIn("private", str(caught.exception))
                else:
                    self.assertTrue(staging_handoff.dispatch(self.raw(), self.env, remote))
            remote.assert_called_once()
            sent = json.loads(remote.call_args.kwargs["input"])
            self.assertEqual(sent, staging_handoff.payload(self.raw(), self.env))
            self.assertNotIn(self.env["IMAGE_HANDOFF_REPOSITORY"], json.dumps(sent) + output.getvalue())
            self.assertNotIn(self.env["IMAGE_HANDOFF_TOKEN"], repr(remote.call_args.args) + json.dumps(sent))
            self.assertNotIn("private", output.getvalue())

    def test_web_cli_reads_receipt_when_enabled_and_sanitizes_failures(self):
        for error in [None, OSError("private-location"), RuntimeError("private-location"),
                      subprocess.TimeoutExpired("private-command", 30)]:
            with self.subTest(error=type(error).__name__), patch.dict(os.environ, self.env, clear=True), \
                    patch.object(Path, "read_bytes", return_value=self.raw()) as read, \
                    patch.object(staging_handoff, "dispatch", return_value=True, side_effect=error) as send, \
                    contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(staging_handoff.main(), 0 if error is None else 1)
            read.assert_called_once()
            send.assert_called_once()
            self.assertNotIn("private", output.getvalue())

    def test_workflow_keeps_private_destination_protected_for_both_components(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/staging-native-images.yml").read_text()
        publish = workflow.split("\n  publish:\n", 1)[1]
        handoff = publish.split("      - name: Emit image publication handoff\n", 1)[1]
        self.assertNotIn("matrix.component == 'api'", handoff)
        self.assertIn("github.event_name == 'push'", handoff)
        self.assertIn("github.ref == 'refs/heads/develop'", handoff)
        self.assertIn("IMAGE_HANDOFF_WEB_ENABLED: ${{ vars.IMAGE_HANDOFF_WEB_ENABLED }}", handoff)
        self.assertNotIn("vars.IMAGE_HANDOFF_REPOSITORY", handoff)
        self.assertLess(publish.index("name: Retain publication receipt"),
                        publish.index("name: Emit image publication handoff"))


if __name__ == "__main__":
    unittest.main()
