"""Reviewed candidate identity survives rebuilds, never unknown values or scopes."""
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

SCANNER = Path(os.environ['TEST_SCANNER'])
sys.path[:0] = [str(SCANNER), str(Path(__file__).resolve().parents[1] / 'tool')]
import scan_image_secrets
from content_bundles import normalized_scope, pattern_identity
from content_catalog import match_findings, read_catalog, tool_identity
from content_identity import archive_identities, layer_identities
from image_secrets.common import ScanError, digest_file
from resolve_content_policy import main
from tests.fixtures import digest, docker_archive, tar_bytes


class BundleCandidates(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.n = 0
        self.value = b'fixtureConfiguration.publicReference'
        self.body = b'const settings={password:' + self.value + b'};'
        self.path = 'usr/share/nginx/html/assets/sections-AbCd1234.js'
        self.pattern = 'usr/share/nginx/html/assets/sections-*.js'
        self.rule = 'gitleaks.image-secret-assignment'

    def scan(self, entries, layers=None):
        self.n += 1; folder = self.root / str(self.n); folder.mkdir()
        archive = folder / 'image.tar'
        docker_archive(archive, layers or [tar_bytes(entries)])
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = scan_image_secrets.main([str(archive), '--output', str(folder / 'raw'),
                                           '--blocking-rules', 'credential'])
        self.assertNotEqual(code, 2)
        report = json.loads((folder / 'raw/REPORT.json').read_text())
        scopes = {}; work = folder / 'work'; work.mkdir()
        identities = archive_identities(archive, work, report, scopes)
        return folder, report, identities, scopes

    def catalog(self, report):
        return {'schema': 'image-secret-content-policy-v2', 'scanner_version': '1.0.3',
                'gitleaks_version': report['gitleaks_version'], **report['policy'], 'entries': [],
                'bundle_candidates': [{'component': 'web', 'path_pattern': self.pattern,
                    'rule': self.rule, 'candidate_sha256': digest(self.value),
                    'classification': 'public-material', 'reason': 'Synthetic public member-expression fixture.'}]}

    def match(self, report, identities, scopes, catalog=None, component='web'):
        path = self.root / 'catalog.json'; path.write_text(json.dumps(catalog or self.catalog(report)))
        return match_findings(read_catalog(path, report), component, report['findings'], identities, scopes)

    def test_rebuilt_renamed_and_relocated_line_retains_exact_candidate(self):
        _, old, _, _ = self.scan([(self.path, self.body)])
        path = self.path.replace('AbCd1234', '9x_Y-Zab')
        _, rebuilt, identities, scopes = self.scan([(path, b'// a new build\n' + self.body)])
        oldrow = next(f for f in old['findings'] if f['rule'] == self.rule)
        newrow = next(f for f in rebuilt['findings'] if f['rule'] == self.rule)
        self.assertNotEqual(oldrow['path'], newrow['path'])
        self.assertNotEqual(oldrow['file_sha256'], newrow['file_sha256'])
        self.assertNotEqual(oldrow['line'], newrow['line'])
        self.assertEqual(oldrow['candidate_sha256'], newrow['candidate_sha256'])
        matched, pending = self.match(rebuilt, identities, scopes)
        self.assertEqual(len(matched), 1); self.assertFalse(pending)

    def test_new_value_in_same_bundle_remains_blocking(self):
        changed = b'const other={password:fixtureConfiguration.changedReference};'
        _, report, ids, scopes = self.scan([(self.path, self.body + changed)])
        matched, pending = self.match(report, ids, scopes)
        self.assertEqual(len(matched), 1)
        self.assertTrue(any(f['rule'] == self.rule and f['candidate_sha256'] != digest(self.value) for f in pending))

    def test_other_chunk_component_rule_and_missing_current_identity_block(self):
        _, report, ids, scopes = self.scan([(self.path, self.body)])
        self.assertFalse(self.match(report, ids, scopes, component='api')[0])
        self.assertFalse(self.match(report, {}, scopes)[0])
        self.assertFalse(self.match(report, ids, {})[0])
        altered = copy.deepcopy(report)
        for row in altered['findings']: row['rule'] = 'gitleaks.github-pat'
        self.assertFalse(self.match(altered, ids, scopes)[0])
        for path in ['usr/share/nginx/html/assets/other-AbCd1234.js',
                     'usr/share/nginx/html/sections-AbCd1234.js',
                     'usr/share/nginx/html/assets/sub/sections-AbCd1234.js',
                     self.path + '.map', self.path.replace('AbCd1234', 'short')]:
            with self.subTest(path=path):
                _, r, i, s = self.scan([(path, self.body)])
                self.assertFalse(self.match(r, i, s)[0])

    def test_new_provider_credential_is_not_covered_by_public_candidate(self):
        import secrets
        token = b'ghp_' + secrets.token_hex(18).encode()
        _, report, ids, scopes = self.scan([(self.path, self.body + b'\nconst token="' + token + b'";')])
        matched, pending = self.match(report, ids, scopes)
        self.assertEqual(len(matched), 1)
        self.assertTrue(any(f['rule'] == 'gitleaks.github-pat' for f in pending))

    def test_links_metadata_and_nested_payloads_cannot_borrow_scope(self):
        import zipfile
        nested = io.BytesIO()
        with zipfile.ZipFile(nested, 'w') as z: z.writestr('inner.js', self.body)
        _, report, ids, scopes = self.scan([(self.path, nested.getvalue())])
        self.assertFalse(self.match(report, ids, scopes)[0])
        # A synthetic detector occurrence on a symlink may get exact-file identity,
        # but must not get a reusable bundle scope.
        _, report, _, _ = self.scan([(self.path, self.body)])
        row = next(f for f in report['findings'] if f['rule'] == self.rule)
        layer = self.root / 'links.tar'
        layer.write_bytes(tar_bytes([('real.js', self.body), (self.path, (tarfile.SYMTYPE, '/real.js'))]))
        scopes = {}; ids = layer_identities(layer, {}, {1: [{**row, 'entry': 1}]}, scopes)
        self.assertTrue(ids); self.assertFalse(scopes)
        # The digest attached to a metadata detection differs from payload bytes.
        layer.write_bytes(tar_bytes([(self.path, self.body)])); scopes = {}
        ids = layer_identities(layer, {}, {0: [{**row, 'file_sha256': digest(b'metadata')}]}, scopes)
        self.assertFalse(ids); self.assertFalse(scopes)

    def test_duplicate_entries_keep_each_occurrence_and_new_value(self):
        other = b'const x={password:fixtureConfiguration.changedReference};'
        _, report, ids, scopes = self.scan([], [tar_bytes([(self.path, self.body), (self.path, other)]),
                                               tar_bytes([('usr/share/nginx/html/assets/.wh.sections-AbCd1234.js', b'')])])
        matched, pending = self.match(report, ids, scopes)
        self.assertEqual(len(matched), 1); self.assertTrue(pending)

    def test_exact_real_decision_still_blocks_scoped_public_value(self):
        _, report, ids, scopes = self.scan([(self.path, self.body)])
        catalog = self.catalog(report)
        catalog['entries'] = [{'component': 'web', 'path': self.path, 'rule': self.rule,
            'file_sha256': digest(self.body), 'candidate_sha256': digest(self.value),
            'classification': 'REAL', 'reason': 'Synthetic stricter classification.'}]
        # Reject the catalog rather than allowing a rename to evade a known REAL.
        with self.assertRaises(ScanError): self.match(report, ids, scopes, catalog)
        catalog['bundle_candidates'] = []
        matched, pending = self.match(report, ids, scopes, catalog)
        self.assertEqual(matched[0]['classification'], 'REAL'); self.assertFalse(pending)

    def test_catalog_refuses_broad_scopes_unknown_modes_or_missing_candidate(self):
        _, report, _, _ = self.scan([(self.path, self.body)])
        original = self.catalog(report)
        for field, value in [('path_pattern', '**/*.js'), ('path_pattern', self.pattern.replace('sections', '*')),
                             ('path_pattern', self.pattern + '*'), ('component', 'api'),
                             ('rule', 'gitleaks.github-pat'), ('candidate_sha256', None),
                             ('classification', 'test-fixture'), ('reason', '')]:
            catalog = copy.deepcopy(original); catalog['bundle_candidates'][0][field] = value
            path = self.root / 'bad.json'; path.write_text(json.dumps(catalog))
            with self.subTest(field=field, value=value), self.assertRaises(ScanError): read_catalog(path, report)
        for mutate in [lambda x: x.update(schema='image-secret-content-policy-v1'),
                       lambda x: x['bundle_candidates'].append(x['bundle_candidates'][0]),
                       lambda x: x['bundle_candidates'][0].update(line=1)]:
            catalog = copy.deepcopy(original); mutate(catalog)
            path = self.root / 'bad.json'; path.write_text(json.dumps(catalog))
            with self.assertRaises(ScanError): read_catalog(path, report)
        self.assertEqual(normalized_scope(self.path), pattern_identity(self.pattern))

    def test_adapter_requires_review_then_emits_archive_bound_sa03_packet(self):
        folder, report, _, _ = self.scan([(self.path, self.body)])
        catalog = folder / 'catalog.json'; catalog.write_text(json.dumps(self.catalog(report)))
        review = folder / 'review.json'
        review.write_text(json.dumps({'verdict': 'GO_CONTENT_POLICY', 'reviewer': 'solution-architect-03',
            'catalog_sha256': digest_file(catalog), 'adapter_files': tool_identity(), 'test_only': True}))
        args = ['--scanner', str(SCANNER), '--archive', str(folder / 'image.tar'),
                '--report', str(folder / 'raw/REPORT.json'), '--catalog', str(catalog), '--component', 'web']
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(main(args + ['--output', str(folder / 'proposal'), '--proposal']), 1)
            self.assertEqual(main(args + ['--output', str(folder / 'approved'), '--review', str(review)]), 0)
        self.assertFalse((folder / 'proposal/REPORT.json').exists())
        packet = json.loads((folder / 'approved/classifications.json').read_text())
        self.assertEqual(packet['archive_sha256'], report['archive_sha256'])
        self.assertEqual(packet['review']['reviewer'], 'solution-architect-03')
        assessed = json.loads((folder / 'approved/REPORT.json').read_text())
        self.assertEqual(assessed['findings'], report['findings'])
        self.assertEqual(assessed['counts']['blocking'], 0)
