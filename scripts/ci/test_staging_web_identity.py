"""Exercise version stability and input/receipt substitution against real Git trees."""

import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from staging_web_identity import (
    LABEL, REQUIRED, build_inputs, checkout_record, verify_web_receipt, write_record,
)


class WebIdentityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name) / "repo"
        self.repo.mkdir()
        self.output = Path(temporary.name) / "output"
        self.output.mkdir()
        self.git("init", "-q")
        for name in REQUIRED | {"ornn-web/src/main.ts", "ornn-web/public/config.js.template"}:
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"version": "1.2.3"}) if name.endswith("package.json")
                            else "build input: " + name + "\n")
        self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.repo, stderr=subprocess.PIPE)

    def commit(self):
        self.git("add", "-A")
        self.git("-c", "user.name=chronoai-shining", "-c",
                 "user.email=250120269+chronoai-shining@users.noreply.github.com",
                 "-c", "commit.gpgsign=false", "commit", "-qm", "Snapshot fixture")

    def receipt(self):
        identity = write_record(self.output / "web-build-inputs.json", self.repo)
        (self.output / "version.json").write_text(json.dumps({"version": "1.2.3+" + identity}))
        record = checkout_record(self.repo)
        metadata = {"webBuildIdentity": identity, "labels": {LABEL: identity}}
        return record, metadata

    def test_policy_commit_changes_provenance_without_changing_spa_identity(self):
        before = checkout_record(self.repo)
        policy = self.repo / "scripts/ci/ornn-content-policy.json"
        policy.write_text("reviewed policy update")
        self.commit()
        after = checkout_record(self.repo)
        self.assertNotEqual(before["sourceRevision"], after["sourceRevision"])
        self.assertEqual(before["identity"], after["identity"])
        self.assertEqual(before["files"], after["files"])
        record, metadata = self.receipt()
        verify_web_receipt(self.output, metadata, record["sourceRevision"], self.repo)

    def test_every_required_input_and_runtime_template_invalidates_identity(self):
        for name in sorted(REQUIRED | {"ornn-web/src/main.ts", "ornn-web/public/config.js.template"}):
            with self.subTest(input=name):
                before = build_inputs(self.repo)["identity"]
                path = self.repo / name
                path.write_text(path.read_text() + "changed build input\n")
                self.commit()
                self.assertNotEqual(build_inputs(self.repo)["identity"], before)

    def test_addition_deletion_and_executable_mode_are_version_inputs(self):
        path = self.repo / "ornn-web/public/added.txt"
        before = build_inputs(self.repo)["identity"]
        path.write_text("new input")
        self.commit()
        added = build_inputs(self.repo)["identity"]
        self.assertNotEqual(added, before)
        path.chmod(0o755)
        self.commit()
        self.assertNotEqual(build_inputs(self.repo)["identity"], added)
        path.unlink()
        self.commit()
        self.assertEqual(build_inputs(self.repo)["identity"], before)

    def test_uncommitted_or_untracked_inputs_cannot_claim_a_committed_identity(self):
        path = self.repo / "bun.lock"
        original = path.read_bytes()
        path.write_text("uncommitted dependency update")
        with self.assertRaisesRegex(ValueError, "differ"):
            checkout_record(self.repo)
        path.write_bytes(original)
        (self.repo / "ornn-web/src/untracked.ts").write_text("untracked source")
        with self.assertRaisesRegex(ValueError, "differ"):
            checkout_record(self.repo)

    def test_missing_inputs_and_links_fail_closed(self):
        path = self.repo / "bun.lock"
        original = path.read_bytes()
        path.unlink()
        self.commit()
        with self.assertRaisesRegex(ValueError, "Missing"):
            build_inputs(self.repo)
        path.write_bytes(original)
        (self.repo / "ornn-web/public/link").symlink_to("../../package.json")
        self.commit()
        with self.assertRaisesRegex(ValueError, "regular"):
            build_inputs(self.repo)

    def test_gitignored_public_asset_cannot_enter_an_unversioned_build(self):
        (self.repo / ".gitignore").write_text("generated.txt\n")
        self.commit()
        (self.repo / "ornn-web/public/generated.txt").write_text("untracked generated asset")
        with self.assertRaisesRegex(ValueError, "Untracked"):
            checkout_record(self.repo)

    def test_receipt_rejects_identity_provenance_and_input_substitution(self):
        record, metadata = self.receipt()
        for field, value in (("identity", "web-" + "0" * 64),
                             ("sourceRevision", "0" * 40), ("files", [])):
            with self.subTest(field=field):
                changed = {**record, field: value}
                (self.output / "web-build-inputs.json").write_text(json.dumps(changed))
                with self.assertRaisesRegex(ValueError, "receipt"):
                    verify_web_receipt(self.output, metadata, record["sourceRevision"], self.repo)
        (self.output / "web-build-inputs.json").write_text(json.dumps(record))
        for field in ("webBuildIdentity", "labels"):
            changed = copy.deepcopy(metadata)
            changed[field] = "web-" + "0" * 64 if field == "webBuildIdentity" else {}
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "image"):
                verify_web_receipt(self.output, changed, record["sourceRevision"], self.repo)
        with self.assertRaisesRegex(ValueError, "revision"):
            verify_web_receipt(self.output, metadata, "0" * 40, self.repo)
        (self.output / "version.json").write_text(json.dumps({"version": "1.2.3+old"}))
        with self.assertRaisesRegex(ValueError, "runtime version"):
            verify_web_receipt(self.output, metadata, record["sourceRevision"], self.repo)
        (self.output / "web-build-inputs.json").unlink()
        with self.assertRaises(FileNotFoundError):
            verify_web_receipt(self.output, metadata, record["sourceRevision"], self.repo)


if __name__ == "__main__":
    unittest.main()
