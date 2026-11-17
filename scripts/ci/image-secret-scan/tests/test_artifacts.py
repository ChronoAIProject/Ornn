import contextlib
import io
import json
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

import scan_image_secrets as cli
from image_secrets.policy import Allowlist, Findings
from tests.fixtures import configuration, digest, docker_archive, fake_key, tar_bytes


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="artifact-tests-")
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def scan(self, archive, expected):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = cli.main([str(archive), "--output", str(self.root / "report")])
        report = json.loads((self.root / "report/REPORT.json").read_text())
        self.assertEqual(code, expected, report.get("error"))
        return report

    def test_all_docker_manifest_images_are_scanned(self):
        layers = [tar_bytes([("hello", b"world")]), tar_bytes([("second.key", fake_key())])]
        configs = [configuration([layer]) for layer in layers]
        manifest = [
            {"Config": digest(config) + ".json", "Layers": [f"layer{i}.tar"], "RepoTags": []}
            for i, config in enumerate(configs)
        ]
        entries = [("manifest.json", json.dumps(manifest).encode())]
        entries += [(digest(config) + ".json", config) for config in configs]
        entries += [(f"layer{i}.tar", layer) for i, layer in enumerate(layers)]
        archive = self.root / "multi.tar"
        archive.write_bytes(tar_bytes(entries))
        report = self.scan(archive, 1)
        self.assertEqual(len(report["inventory"]["images"]), 2)
        self.assertTrue(any(f["image"] == 1 for f in report["findings"]))

    def test_zstd_oci_all_platforms_and_repeated_descriptor(self):
        blobs = {}

        def blob(data, media):
            checksum = digest(data)
            blobs["blobs/sha256/" + checksum] = data
            return {"mediaType": media, "digest": "sha256:" + checksum, "size": len(data)}

        descriptors = []
        for arch in ["amd64", "arm64"]:
            layer = tar_bytes([(arch + ".txt", b"hello")])
            packed = subprocess.run(["zstd", "-q", "-c"], input=layer, check=True, capture_output=True).stdout
            config = blob(
                configuration([layer], {"architecture": arch}), "application/vnd.oci.image.config.v1+json"
            )
            layer_desc = blob(packed, "application/vnd.oci.image.layer.v1.tar+zstd")
            manifest = {"schemaVersion": 2, "config": config, "layers": [layer_desc]}
            descriptors.append(
                blob(json.dumps(manifest).encode(), "application/vnd.oci.image.manifest.v1+json")
            )
        index = {"schemaVersion": 2, "manifests": descriptors + [descriptors[0]]}
        archive = self.root / "multi-platform.tar"
        archive.write_bytes(
            tar_bytes(
                list(blobs.items())
                + [
                    ("index.json", json.dumps(index).encode()),
                    ("oci-layout", b'{"imageLayoutVersion":"1.0.0"}'),
                ]
            )
        )
        report = self.scan(archive, 0)
        self.assertEqual(len(report["inventory"]["images"]), 2)
        self.assertEqual(len(report["inventory"]["layers"]), 2)

    def test_allowlisted_value_does_not_hide_another_value_on_same_line(self):
        public_value, secret_value = b"public-example-value", b"different-private-value"
        allow = self.root / "allow.json"
        allow.write_text(
            json.dumps(
                {
                    "version": 1,
                    "entries": [
                        {
                            "id": "public-value",
                            "rule": "gitleaks.example",
                            "scope": "layer",
                            "path": "same.txt",
                            "reason": "Test public value",
                            "match_sha256": digest(public_value),
                        }
                    ],
                }
            )
        )
        findings = Findings(Allowlist(allow))
        location = {"scope": "layer", "image": 0, "layer": 0, "entry": 0, "path": "same.txt"}
        findings.add("gitleaks.example", location, digest(public_value), line=1)
        findings.add("gitleaks.example", location, digest(secret_value), line=1)
        self.assertEqual(len(findings.allowed), 1)
        self.assertEqual(len(findings.items), 1)

    def test_publication_step_blocks_findings_errors_and_artifact_changes(self):
        snippet = (cli.HERE / "github-actions-step.yml").read_text()
        script = textwrap.dedent(snippet.split("  run: |\n", 1)[1])
        subprocess.run(["bash", "-n"], input=script.encode(), check=True, capture_output=True)
        for scenario in ["clean", "findings", "error", "tampered"]:
            root = self.root / scenario
            root.mkdir()
            archive = root / "input.tar"
            if scenario == "error":
                archive.write_bytes(b"invalid")
            else:
                files = [("hello.txt", b"hello")]
                if scenario == "findings":
                    files.append(("fake.key", fake_key()))
                docker_archive(archive, [tar_bytes(files)])
            tools = root / "bin"
            tools.mkdir()
            docker = tools / "docker"
            docker.write_text(
                textwrap.dedent("""\
                #!/usr/bin/env python3
                import json, os, shutil, sys
                from pathlib import Path
                args = sys.argv[1:]
                with open(os.environ["FAKE_DOCKER_TRACE"], "a") as f:
                    f.write(json.dumps(args[:2]) + "\\n")
                if args[:2] == ["image", "inspect"]:
                    print("sha256:" + "a" * 64)
                elif args[:2] == ["image", "save"]:
                    shutil.copyfile(os.environ["FAKE_SOURCE_ARCHIVE"], args[args.index("--output") + 1])
                elif args[0] != "build" and args[:2] not in (["image", "load"], ["image", "push"]):
                    raise SystemExit(2)
                """)
            )
            docker.chmod(0o755)
            scanner = root / ".github/scripts/scan-image-secrets"
            scanner.mkdir(parents=True)
            wrapper = scanner / "scan-image-secrets.sh"
            wrapper.write_text("""#!/usr/bin/env bash
set -euo pipefail
"$REAL_SCANNER" "$@"
if [[ "$TEST_SCENARIO" == tampered ]]; then printf 'changed' >> "$1"; fi
""")
            wrapper.chmod(0o755)
            env = dict(
                os.environ,
                PATH=str(tools) + os.pathsep + os.environ["PATH"],
                FAKE_DOCKER_TRACE=str(root / "trace.jsonl"),
                FAKE_SOURCE_ARCHIVE=str(archive),
                IMAGE_REPOSITORY="example.invalid/test",
                RUNNER_TEMP=str(root),
                GITHUB_SHA="a" * 40,
                GITHUB_RUN_ID="1",
                GITHUB_RUN_ATTEMPT="1",
                REAL_SCANNER=str(cli.HERE / "scan-image-secrets.sh"),
                TEST_SCENARIO=scenario,
            )
            result = subprocess.run(
                ["bash"],
                input=script.encode(),
                check=False,
                capture_output=True,
                cwd=root,
                env=env,
                timeout=60,
            )
            trace = [json.loads(line) for line in (root / "trace.jsonl").read_text().splitlines()]
            self.assertEqual(sum(row[0] == "build" for row in trace), 1)
            self.assertEqual(["image", "push"] in trace, scenario == "clean")
            self.assertEqual(["image", "load"] in trace, scenario == "clean")
            self.assertEqual(result.returncode == 0, scenario == "clean")


if __name__ == "__main__":
    unittest.main()
