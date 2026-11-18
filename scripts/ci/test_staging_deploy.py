"""Offline public boundary tests; no credentials, registry or deployment writes."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import staging_deploy as controller


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.config = {'reader_app_id': '12345', 'schema': 'ornn-public-deploy-v1', 'infra_repository': 'fixture/controller',
                       'infra_ref': 'a' * 40, 'owner_risk_accepted': True,
                       'profiles': {'api': {'hostname': 'private.invalid'}}}
        raw = json.dumps(self.config)
        self.env = {'GITHUB_REPOSITORY': 'ChronoAIProject/Ornn', 'GITHUB_EVENT_NAME': 'push',
                    'GITHUB_REF': 'refs/heads/develop', 'GITHUB_ACTIONS': 'true',
                    'GITHUB_WORKSPACE': str(self.root), 'RUNNER_TEMP': str(self.root),
                    'GITHUB_OUTPUT': str(self.root / 'output'),
                    'ORNN_INFRA_CONFIG': raw, 'ORNN_INFRA_CONFIG_MASK': raw}

    def prepare(self):
        controller.configure(self.env, emit=lambda _: None)
        source = self.root / 'deployment-source/staging/scripts'; source.mkdir(parents=True)
        (source / 'public_runner.py').write_text('')
        for component in ('api', 'web'):
            path = self.root / 'deployment-receipts' / component
            path.mkdir(parents=True); (path / 'publication.json').write_text('{}')

    def test_configuration_masks_before_output_and_uses_private_file_mode(self):
        messages = []
        controller.configure(self.env, emit=messages.append)
        self.assertIn('::add-mask::private.invalid', messages)
        self.assertIn('::add-mask::fixture/controller', messages)
        self.assertIn('::add-mask::fixture', messages)
        self.assertEqual(messages[-1], 'PASS deployment configuration')
        self.assertEqual((self.root / 'deployment-config.json').stat().st_mode & 0o777, 0o600)
        self.assertIn('ref=' + 'a' * 40, (self.root / 'output').read_text())

    def test_missing_stale_mask_context_and_mutable_ref_refused(self):
        for key, value in [('ORNN_INFRA_CONFIG_MASK', ''), ('ORNN_INFRA_CONFIG_MASK', '{}'),
                           ('GITHUB_EVENT_NAME', 'pull_request'), ('GITHUB_REF', 'refs/heads/main'),
                           ('GITHUB_REPOSITORY', 'other/repo'), ('GITHUB_ACTIONS', 'false')]:
            with self.subTest(key=key), self.assertRaises(controller.Refused):
                controller.configure({**self.env, key: value})
        for key, value in [('infra_ref', 'main'), ('infra_repository', '../repo'),
                           ('owner_risk_accepted', False), ('schema', 'other'),
                           ('profiles', {'bad': 'line\nINJECT'})]:
            raw = json.dumps({**self.config, key: value})
            with self.subTest(key=key), self.assertRaises(controller.Refused):
                controller.configure({**self.env, 'ORNN_INFRA_CONFIG': raw, 'ORNN_INFRA_CONFIG_MASK': raw})
        self.assertFalse((self.root / 'deployment-config.json').exists())

    def test_duplicate_config_and_output_injection_refused(self):
        raw = '{"schema":"x","schema":"y"}'
        with self.assertRaises(controller.Refused):
            controller.configure({**self.env, 'ORNN_INFRA_CONFIG': raw, 'ORNN_INFRA_CONFIG_MASK': raw})
        with self.assertRaises(controller.Refused): controller.unique_object([('a', 1), ('a', 2)])

    def test_api_then_web_and_no_raw_subprocess_text(self):
        self.prepare(); calls = []; messages = []
        def run(command, **kwargs):
            component = kwargs['env']['ORNN_DEPLOY_COMPONENT']; calls.append(component)
            self.assertTrue(kwargs['capture_output']); self.assertEqual(kwargs['timeout'], 1500)
            self.assertEqual(kwargs['env']['ORNN_PUBLICATION_PATH'],
                             str(self.root / 'deployment-receipts' / component / 'publication.json'))
            return subprocess.CompletedProcess(command, 0, json.dumps({'component': component,
                'result': 'PASS', 'recovery': 'NOT_ATTEMPTED', 'mutations': 1}), 'PRIVATE_RESPONSE')
        controller.deploy_components(self.env, run=run, emit=messages.append)
        self.assertEqual(calls, ['api', 'web'])
        self.assertNotIn('PRIVATE_RESPONSE', str(messages))
        controller.cleanup(self.env)
        self.assertFalse((self.root / 'deployment-source').exists())
        self.assertFalse((self.root / 'deployment-config.json').exists())
        self.assertFalse((self.root / 'deployment-receipts').exists())

    def test_failure_or_untrusted_output_stops_before_web(self):
        self.prepare()
        for output in ['PRIVATE_RESPONSE', json.dumps({'component': 'api', 'result': 'STOP',
                'recovery': 'VERIFIED', 'mutations': 2}), json.dumps({'component': 'api',
                'result': 'PASS', 'recovery': 'PRIVATE_RESPONSE', 'mutations': 1})]:
            calls = []; messages = []
            def run(command, **kwargs):
                calls.append(command)
                return subprocess.CompletedProcess(command, 1, output, 'PRIVATE_STDERR')
            with self.subTest(output=output), self.assertRaises((controller.Refused, ValueError)):
                controller.deploy_components(self.env, run=run, emit=messages.append)
            self.assertEqual(len(calls), 1)
            self.assertNotIn('PRIVATE_RESPONSE', str(messages))
            self.assertNotIn('PRIVATE_STDERR', str(messages))

    def test_cli_emits_only_fixed_error_even_on_exception(self):
        for command in ['invalid', 'configure', 'deploy']:
            with patch('sys.argv', ['runner', command]), patch.dict(os.environ, {}, clear=True), \
                    contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(controller.main(), 1)
                self.assertTrue(output.getvalue().startswith('::error::Staging deployment stopped;'))
        with patch('sys.argv', ['runner', 'cleanup']), patch.dict(os.environ, self.env, clear=True):
            self.assertEqual(controller.main(), 0)

    def test_workflow_preserves_publication_and_has_one_push_only_deploy(self):
        workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/staging-native-images.yml').read_text()
        before, deploy = workflow.split('\n  deploy:\n')
        self.assertIn('staging-scan-image.sh', before)
        self.assertIn('staging-image-out/publication.json', before)
        self.assertIn('needs: [publish_api, publish_web]', deploy)
        self.assertIn("github.event_name == 'push'", deploy)
        self.assertIn("github.ref == 'refs/heads/develop'", deploy)
        self.assertIn('environment: staging', deploy)
        self.assertIn('group: staging-deploy', deploy)
        self.assertIn('cancel-in-progress: false', deploy)
        self.assertIn('permission-contents: read', deploy)
        self.assertIn("vars.ORNN_INFRA_CONFIG == secrets.ORNN_INFRA_CONFIG_MASK && secrets.ORNN_INFRA_CONFIG_MASK || ''", deploy)
        self.assertIn('persist-credentials: false', deploy)
        self.assertIn('ref: ${{ steps.configuration.outputs.ref }}', deploy)
        self.assertIn('if: always()', deploy)
        for forbidden in ['upload-artifact', 'repository_dispatch', 'IMAGE_HANDOFF_', 'self-hosted', 'pull_request_target']:
            self.assertNotIn(forbidden, deploy)
        self.assertNotIn('staging_handoff.py', workflow)
        import re
        for action in re.findall(r'uses: (\S+)', workflow):
            self.assertRegex(action, r'^[A-Za-z0-9_./-]+@[0-9a-f]{40}$')
