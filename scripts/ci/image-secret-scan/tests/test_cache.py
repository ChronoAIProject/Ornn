"""Detector evidence reuse never substitutes for image/policy validation."""
import contextlib
import base64
import os
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from types import SimpleNamespace
from unittest.mock import Mock, patch

import scan_image_secrets as cli
from image_secrets.backend import Gitleaks
from image_secrets.cache import DetectorCache, canonical
from image_secrets.common import ScanError, digest_file, digest_bytes
from tests.fixtures import docker_archive, tar_bytes, fake_key


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.count = 0

    def scan(self, archive, cache=None, extra=(), expected_error=None):
        self.count += 1
        output = self.root / f'report-{self.count}'
        cache_output = self.root / f'cache-{self.count}.json'
        args = [str(archive), '--output', str(output), '--detector-cache-output', str(cache_output), *extra]
        if cache is not None: args += ['--detector-cache', str(cache)]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = cli.main(args)
        report = json.loads((output / 'REPORT.json').read_text())
        if expected_error is None:
            self.assertNotEqual(code, 2, report.get('error'))
        else:
            self.assertEqual(code, 2)
            self.assertEqual(report['error'], expected_error)
            self.assertFalse(report['complete'])
            self.assertFalse(cache_output.exists())
        return report, cache_output

    def assert_equivalent(self, a, b):
        for field in ['inventory', 'scanned_bytes', 'complete', 'status', 'counts']:
            self.assertEqual(a[field], b[field], field)
        for field in ['findings', 'allowlisted']:
            self.assertEqual(sorted(a[field], key=canonical), sorted(b[field], key=canonical), field)

    def test_unchanged_layer_blob_reuses_every_detector_entry_without_losing_findings(self):
        path = self.root / 'image.tar'; secret = fake_key()
        docker_archive(path, [tar_bytes([('key.pem', secret), ('key.pem', b'overwritten'),
                                        ('clean.txt', b'clean'), ('last.txt', secret)]),
                              tar_bytes([('.wh.key.pem', b'')])])
        cold, cache = self.scan(path)
        warm, _ = self.scan(path, cache)
        self.assert_equivalent(cold, warm)
        self.assertGreater(warm['detector_cache']['hits'], 0)
        self.assertEqual(warm['detector_cache']['misses'], 0)
        self.assertNotIn(secret.decode().splitlines()[1], cache.read_text())
        self.assertNotIn('key.pem', cache.read_text())
        self.assertTrue(any(f['rule']=='content.private-key-header' for f in warm['findings']))

    def test_new_secret_in_changed_blob_and_config_is_freshly_detected(self):
        path = self.root / 'old.tar'; changed = self.root / 'new.tar'
        docker_archive(path, [tar_bytes([('a.txt', b'clean'), ('b.txt', b'unchanged')])])
        _, cache = self.scan(path)
        docker_archive(changed, [tar_bytes([('a.txt', fake_key()), ('b.txt', b'unchanged')])],
                       {'config': {'Env': ['PASSWORD=synthetic_changed_secret_3523']}})
        full, _ = self.scan(changed); warm, _ = self.scan(changed, cache)
        self.assert_equivalent(full, warm)
        self.assertGreater(warm['detector_cache']['hits'], 0)
        self.assertGreater(warm['detector_cache']['misses'], 0)
        self.assertTrue(any(f['scope']=='config' for f in warm['findings']))

    def test_allowlist_is_reapplied_and_cannot_hide_second_occurrence(self):
        path = self.root / 'image.tar'
        value=base64.b64encode(os.urandom(60))
        body=b'value="'+value+b'"\n'
        docker_archive(path,[tar_bytes([('public.txt',body),('private.txt',body)])])
        cold, cache=self.scan(path)
        row=next(f for f in cold['findings'] if f['rule']=='gitleaks.image-high-entropy')
        allow=self.root/'allow.json'
        allow.write_text(json.dumps({'version':1,'entries':[{'id':'public-test','rule':'gitleaks.image-high-entropy',
            'scope':'layer','path':'public.txt','match_sha256':digest_bytes(value),'reason':'Generated test value.'}]}))
        full,_=self.scan(path,extra=['--allowlist',str(allow)])
        warm,_=self.scan(path,cache,extra=['--allowlist',str(allow)])
        self.assert_equivalent(full,warm)
        self.assertEqual(len(warm['allowlisted']),1)
        self.assertIn(row['candidate_sha256'],{f.get('candidate_sha256') for f in warm['findings']})

    def test_stale_corrupt_invalid_or_unknown_fields_force_detector_misses(self):
        path=self.root/'image.tar';docker_archive(path,[tar_bytes([('a.txt',fake_key())])])
        cold,cache=self.scan(path)
        original=json.loads(cache.read_text())
        for kind in ['identity','corrupt','extra','entry']:
            value=json.loads(json.dumps(original))
            if kind=='identity': value['identity']='0'*64
            if kind=='extra': value['extra']='untrusted'
            if kind=='entry': value['entries'][next(iter(value['entries']))]=[{'rule':'bad'}]
            bad=self.root/f'bad-{kind}.json';bad.write_text('invalid' if kind=='corrupt' else json.dumps(value))
            warm,_=self.scan(path,bad)
            self.assert_equivalent(cold,warm)
            self.assertEqual(warm['detector_cache']['hits'],0)
            self.assertEqual(warm['detector_cache']['invalid'],1)

    def test_limits_and_rules_are_part_of_identity(self):
        path=self.root/'image.tar';docker_archive(path,[tar_bytes([('clean.txt',b'clean')])])
        _,cache=self.scan(path)
        warm,_=self.scan(path,cache,extra=['--max-entries','999999'])
        self.assertEqual(warm['detector_cache']['hits'],0)
        self.assertEqual(warm['detector_cache']['invalid'],1)

    def test_incomplete_backend_does_not_write_reusable_evidence(self):
        path=self.root/'image.tar';docker_archive(path,[tar_bytes([('a.txt',b'clean')])])
        with patch.object(Gitleaks,'detect',side_effect=ScanError('gitleaks-incomplete')):
            with self.assertRaises(AssertionError): self.scan(path)
        self.assertFalse((self.root/'cache-1.json').exists())

    def test_nested_payload_and_changed_metadata_are_freshly_validated_on_hits(self):
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, 'w') as archive:
            archive.writestr('key.pem', fake_key())
        original = self.root / 'original.tar'; changed = self.root / 'renamed.tar'
        docker_archive(original, [tar_bytes([('bundle.dat', nested.getvalue())])])
        cold, cache = self.scan(original)
        warm, _ = self.scan(original, cache)
        self.assert_equivalent(cold, warm)
        self.assertTrue(any(f['rule'] == 'content.private-key-header' for f in warm['findings']))
        self.assertEqual(warm['detector_cache']['misses'], 0)
        # A changed archive path still runs path/metadata policy on cached bytes.
        docker_archive(changed, [tar_bytes([('.env', nested.getvalue())])])
        full, _ = self.scan(changed); reused, _ = self.scan(changed, cache)
        self.assert_equivalent(full, reused)
        self.assertGreater(reused['detector_cache']['hits'], 0)
        self.assertGreater(reused['detector_cache']['misses'], 0)

    def test_warm_cache_cannot_bypass_archive_digest_or_budget_failures(self):
        original = self.root / 'original.tar'; corrupt = self.root / 'corrupt.tar'
        layer = tar_bytes([('a.txt', b'clean')])
        docker_archive(original, [layer])
        _, cache = self.scan(original)
        docker_archive(corrupt, [layer], {'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + '0' * 64]}})
        self.scan(corrupt, cache, expected_error='layer-diff-id-mismatch')
        self.scan(original, cache, extra=['--max-bytes', '1'], expected_error='archive-byte-budget-exceeded')

    def test_index_preserves_nested_mapping_and_blob_cache_invalidates_changes(self):
        path=self.root/'x.txt';path.write_bytes(b'clean')
        stage=self.root;loc={'scope':'layer','image':0,'layer':0,'entry':0,'path':'actual'}
        index=Gitleaks.index(stage,{path:loc})
        self.assertEqual(Gitleaks.resolve_index(str(path)+'!inner',index)[0]['path'],'actual!inner')
        with self.assertRaises(ScanError): Gitleaks.resolve_index('foreign',index)
        cache=DetectorCache('a'*64)
        cache.store(path,digest_file(path),[])
        self.assertEqual(cache.lookup(path,digest_file(path)),[])
        path.write_bytes(b'changed')
        self.assertIsNone(cache.lookup(path,digest_file(path)))

    def test_many_findings_hash_each_physical_file_once(self):
        stage = self.root / 'layer'; stage.mkdir()
        physical = stage / 'entry-00000000.txt'; physical.write_bytes(b'synthetic test input')
        location = {'scope': 'layer', 'image': 0, 'layer': 0, 'entry': 0, 'path': 'actual'}
        backend = Gitleaks('gitleaks', cli.HERE / 'gitleaks.toml', self.root, 20)
        findings = Mock()
        rows = [{'File': str(physical), 'RuleID': 'synthetic-rule', 'Secret': 'synthetic-value',
                 'StartLine': line} for line in range(1, 101)]
        def detector(*args, **kwargs):
            (self.root / 'gitleaks-private.json').write_text(json.dumps(rows))
            return SimpleNamespace(returncode=1)
        with patch('image_secrets.backend.subprocess.run', side_effect=detector), \
                patch('image_secrets.backend.digest_file', wraps=digest_file) as hashing:
            backend.detect(stage, {physical: location}, findings)
        self.assertEqual(hashing.call_count, 1)
        self.assertEqual(findings.add.call_count, 100)
        self.assertEqual(backend.metrics['digest_files'], 1)
