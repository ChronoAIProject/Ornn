"""No-disclosure checks for the public deployment diagnostic protocol."""
import copy
import json
import subprocess
import unittest

from test_staging_deploy import DeploymentTests
from staging_deploy import Refused, deploy_components
from staging_deploy_diagnostics import emit_rows, validated_rows


class DiagnosticProtocolTests(unittest.TestCase):
    def setUp(self):
        self.row = {'phase': 'forward', 'gate': 'smoke', 'result': 'STOP', 'reason': 'web_cors_origin'}

    def test_fixed_rows_are_machine_readable(self):
        messages = []
        emit_rows('web', [self.row], messages.append)
        self.assertEqual(json.loads(messages[0]), {'component': 'web', **self.row})

    def test_hostile_batch_never_emits_even_valid_prefix(self):
        for field in self.row:
            broken = {**self.row, field: 'PRIVATE_IDENTIFIER'}
            messages = []
            with self.subTest(field=field), self.assertRaises(ValueError):
                emit_rows('web', [self.row, broken], messages.append)
            self.assertEqual(messages, [])
        for rows in [None, {}, [self.row] * 65, [{**self.row, 'body': 'PRIVATE_RESPONSE'}],
                     [{**self.row, 'reason': {'private': 'value'}}]]:
            with self.subTest(rows=rows), self.assertRaises(ValueError): validated_rows(rows)

    def test_empty_and_maximum_batches_are_bounded(self):
        self.assertEqual(validated_rows([]), [])
        self.assertEqual(len(validated_rows([self.row] * 64)), 64)
        rows = validated_rows([self.row]); rows[0]['reason'] = 'ok'
        self.assertEqual(self.row['reason'], 'web_cors_origin')


class DiagnosticAdapterTests(DeploymentTests):
    def test_forward_and_recovery_codes_are_visible_before_stop(self):
        self.prepare(); messages = []; calls = []
        rows = [{'phase': 'forward', 'gate': 'smoke', 'result': 'STOP', 'reason': 'web_cors_origin'},
                {'phase': 'recovery', 'gate': 'authenticated_read', 'result': 'STOP', 'reason': 'http_401'}]
        def run(command, **kwargs):
            self.assertEqual(kwargs['env']['ORNN_DEPLOY_DIAGNOSTICS'], '1')
            calls.append(command)
            return subprocess.CompletedProcess(command, 1, json.dumps({'component': 'api', 'result': 'STOP',
                'recovery': 'FAILED_STOP', 'mutations': 2, 'diagnostics': rows}), 'PRIVATE_STDERR')
        with self.assertRaises(Refused): deploy_components(self.env, run=run, emit=messages.append)
        self.assertEqual(len(calls), 1)
        self.assertEqual([json.loads(x)['reason'] for x in messages if x.startswith('{')], ['web_cors_origin', 'http_401'])
        self.assertNotIn('PRIVATE_STDERR', str(messages))

    def test_unknown_or_oversized_output_is_never_echoed(self):
        self.prepare()
        state = {'component': 'api', 'result': 'PASS', 'recovery': 'NOT_ATTEMPTED', 'mutations': 0,
                 'diagnostics': [{'phase': 'forward', 'gate': 'smoke', 'result': 'STOP', 'reason': 'PRIVATE_DATA'}]}
        for output in [json.dumps(copy.deepcopy(state)), 'PRIVATE_DATA' * 2000]:
            messages = []
            def run(command, **kwargs): return subprocess.CompletedProcess(command, 0, output, 'PRIVATE_STDERR')
            with self.assertRaises((Refused, ValueError)): deploy_components(self.env, run=run, emit=messages.append)
            self.assertNotIn('PRIVATE', str(messages))
