"""Public diagnostics identify failure phases without copying remote payloads."""
from contextlib import redirect_stdout
import io
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from staging_registry import CraneRegistry, RegistryOperationError, publish_exact


class RegistryDiagnosticTests(unittest.TestCase):
    def test_fixed_categories_and_status_never_include_remote_values(self):
        cases = [
            (b'Error: POST https://example.invalid/private?token=SENSITIVE: DENIED: permission_denied: write_package', 'authorization', 'unknown'),
            (b'Error: unexpected status code 403 Forbidden SENSITIVE', 'unclassified', '403'),
            (b'Error: POST https://example.invalid: TOOMANYREQUESTS: SENSITIVE', 'rate_limit', 'unknown'),
            (b'Error: MANIFEST_INVALID SENSITIVE', 'invalid_content', 'unknown'),
            (b'Error: x509: certificate SENSITIVE', 'tls', 'unknown'),
            (b'Error: connection refused SENSITIVE', 'network', 'unknown'),
            (b'Error: loading SENSITIVE as OCI layout: missing file', 'local_layout', 'unknown'),
            (b'Error: SENSITIVE\xff\n::warning::injected', 'unclassified', 'unknown'),
        ]
        for raw, category, status in cases:
            with self.subTest(category=category):
                error = RegistryOperationError('push', raw)
                self.assertEqual(str(error), f'Registry push failed; category={category}; http_status={status}; raw output withheld')
                self.assertNotIn('SENSITIVE', str(error))
                self.assertNotIn('::warning::', str(error))
        self.assertIn('Registry operation failed', str(RegistryOperationError('SENSITIVE', b'')))

    def test_failed_push_is_one_attempt_with_sanitized_operation_annotation(self):
        run = Mock(return_value=SimpleNamespace(returncode=1, stdout=b'SENSITIVE', stderr=b'DENIED: SENSITIVE'))
        crane = CraneRegistry(run=run)
        registry = Mock()
        registry.lookup.side_effect = [None, None]
        registry.push.side_effect = lambda layout, target: crane.push(layout, target)
        history = Mock(); history.snapshot.return_value = {}
        output = io.StringIO()
        with patch('staging_registry.verify_layout'), redirect_stdout(output), self.assertRaises(RegistryOperationError):
            publish_exact(registry, 'ghcr.io/chronoaiproject/ornn-api:' + 'a' * 40,
                          'layout', 'pulled', {}, 'sha256:' + 'b' * 64, {}, history=history)
        run.assert_called_once()
        registry.verify.assert_not_called()
        self.assertEqual(history.snapshot.call_count, 1)
        self.assertIn('::error title=Ornn registry operation failed::Registry push failed; category=authorization', output.getvalue())
        self.assertNotIn('SENSITIVE', output.getvalue())
        self.assertNotIn('concurrent writer', output.getvalue())

    def test_success_returns_bytes_without_failure_annotation(self):
        run = Mock(return_value=SimpleNamespace(returncode=0, stdout=b'valid', stderr=b'SENSITIVE'))
        self.assertEqual(CraneRegistry(run=run).invoke(['manifest', 'ref']), b'valid')
        run.assert_called_once()
