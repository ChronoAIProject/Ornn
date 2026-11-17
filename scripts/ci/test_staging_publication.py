"""Registry-free verification of exact-archive publication and collision handling."""

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from staging_oci import blob_name, extract_layout, verify_layout, verify_manifest
from staging_registry import CraneRegistry, missing_manifest, publish_exact
import staging_publish


class PublicationTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.archive = self.root / 'image.tar.gz'
        self.layout = self.root / 'oci'
        self.pulled = self.root / 'pulled'
        self.payloads = {}

        def blob(data, media):
            digest = 'sha256:' + hashlib.sha256(data).hexdigest()
            desc = {'digest': digest, 'size': len(data), 'mediaType': media}
            self.payloads[blob_name(desc)] = data
            return desc

        config = blob(b'{"config":{}}', 'application/vnd.oci.image.config.v1+json')
        layer = blob(b'exact layer bytes', 'application/vnd.oci.image.layer.v1.tar')
        self.manifest = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                         'config': config, 'layers': [layer]}
        descriptor = blob(json.dumps(self.manifest).encode(), self.manifest['mediaType'])
        self.digest = descriptor['digest']
        self.payloads['index.json'] = json.dumps({'schemaVersion': 2, 'manifests': [descriptor]}).encode()
        self.payloads['oci-layout'] = b'{"imageLayoutVersion":"1.0.0"}'
        self.payloads['manifest.json'] = json.dumps([
            {'Config': blob_name(config), 'Layers': [blob_name(layer)]}]).encode()
        self.metadata = {'configDigest': config['digest'], 'layerDiffIds': [layer['digest']]}
        self.target = 'ghcr.io/chronoaiproject/ornn-api:' + 'a' * 40
        self.write_archive()

    def write_archive(self, duplicate=False, symlink=False):
        with tarfile.open(self.archive, 'w:gz') as tar:
            for name, data in self.payloads.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                if symlink and name == blob_name(self.manifest['layers'][0]):
                    member.type = tarfile.SYMTYPE
                    member.linkname = '/outside'
                    member.size = 0
                    tar.addfile(member)
                    continue
                tar.addfile(member, io.BytesIO(data))
            if duplicate:
                member = tarfile.TarInfo('index.json')
                member.size = len(self.payloads['index.json'])
                tar.addfile(member, io.BytesIO(self.payloads['index.json']))

    def extract(self):
        return extract_layout(self.archive, self.layout, self.metadata)

    def registry(self, existing=None):
        registry = Mock()
        registry.lookup.side_effect = [existing, (self.digest, self.manifest)]
        registry.push.return_value = self.digest

        def verify(ref, output, manifest, digest, metadata):
            shutil.copytree(self.layout, output)
            verify_layout(output, manifest, digest, metadata)
        registry.verify.side_effect = verify
        return registry

    def publish(self, registry):
        return publish_exact(registry, self.target, self.layout, self.pulled,
                             self.manifest, self.digest, self.metadata)

    def test_missing_tag_pushes_exact_manifest_then_verifies_all_blobs(self):
        self.assertEqual(self.extract(), (self.manifest, self.digest))
        registry = self.registry()
        self.assertEqual(self.publish(registry), 'published')
        registry.push.assert_called_once_with(self.layout, self.target)
        registry.verify.assert_called_once()
        for name, data in self.payloads.items():
            if name.startswith('blobs/'):
                self.assertEqual((self.pulled / name).read_bytes(), data)

    def test_exact_archive_already_published_is_reused_without_write(self):
        self.extract()
        registry = self.registry((self.digest, self.manifest))
        self.assertEqual(self.publish(registry), 'reused')
        registry.push.assert_not_called()
        registry.verify.assert_called_once()

    def test_different_manifest_or_ambiguous_lookup_never_pushes(self):
        self.extract()
        for existing in (('sha256:' + 'b' * 64, self.manifest), (self.digest, {})):
            registry = self.registry(existing)
            with self.assertRaises(ValueError):
                self.publish(registry)
            registry.push.assert_not_called()
        registry = self.registry()
        registry.lookup.side_effect = ValueError('read failure')
        with self.assertRaises(ValueError):
            self.publish(registry)
        registry.push.assert_not_called()

    def test_changed_pushed_digest_or_tag_fails_before_receipt(self):
        self.extract()
        registry = self.registry()
        registry.push.return_value = 'sha256:' + 'b' * 64
        with self.assertRaises(ValueError):
            self.publish(registry)
        registry.verify.assert_not_called()
        registry = self.registry((self.digest, self.manifest))
        registry.lookup.side_effect = [(self.digest, self.manifest), None]
        with self.assertRaises(ValueError):
            self.publish(registry)
        registry.push.assert_not_called()

    def test_corrupted_layout_fails_before_registry_access(self):
        self.extract()
        (self.layout / blob_name(self.manifest['layers'][0])).write_bytes(b'bad')
        registry = self.registry()
        with self.assertRaises(ValueError):
            self.publish(registry)
        registry.lookup.assert_not_called()

    def test_corrupt_duplicate_and_linked_archive_members_fail(self):
        for mode in ('corrupt', 'duplicate', 'symlink'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp:
                data = self.payloads[blob_name(self.manifest['layers'][0])]
                if mode == 'corrupt':
                    self.payloads[blob_name(self.manifest['layers'][0])] = b'altered bytes'
                self.write_archive(duplicate=mode == 'duplicate', symlink=mode == 'symlink')
                with self.assertRaises(ValueError):
                    extract_layout(self.archive, Path(temp) / 'oci', self.metadata)
                self.payloads[blob_name(self.manifest['layers'][0])] = data

    def test_wrong_config_layer_media_and_unsafe_descriptor_fail(self):
        for field, value in (('configDigest', 'sha256:' + 'b' * 64), ('layerDiffIds', [])):
            with self.assertRaises(ValueError):
                verify_manifest(self.manifest, dict(self.metadata, **{field: value}))
        manifest = copy.deepcopy(self.manifest)
        manifest['layers'][0]['mediaType'] = 'application/vnd.oci.image.layer.v1.tar+gzip'
        with self.assertRaises(ValueError):
            verify_manifest(manifest, self.metadata)
        for desc in ({'digest': '../outside', 'size': 1}, {'digest': self.digest, 'size': -1}):
            with self.assertRaises(ValueError):
                blob_name(desc)

    def test_registry_transport_proves_raw_manifest_digest(self):
        raw = self.payloads['blobs/' + self.digest.replace(':', '/')]
        run = Mock(side_effect=[SimpleNamespace(returncode=0, stdout=raw + b'\n'),
                                SimpleNamespace(returncode=0, stdout=self.digest.encode())])
        self.assertEqual(CraneRegistry(run=run).lookup(self.target), (self.digest, self.manifest))
        run = Mock(side_effect=[SimpleNamespace(returncode=0, stdout=raw),
                                SimpleNamespace(returncode=0, stdout=('sha256:' + 'b' * 64).encode())])
        with self.assertRaises(ValueError):
            CraneRegistry(run=run).lookup(self.target)

    def test_only_exact_manifest_unknown_response_permits_push(self):
        error = ('Error: fetching manifest ' + self.target + ': GET https://ghcr.io/v2/'
                 'chronoaiproject/ornn-api/manifests/' + 'a' * 40 + ': MANIFEST_UNKNOWN: manifest unknown')
        self.assertTrue(missing_manifest(error, self.target))
        run = Mock(return_value=SimpleNamespace(returncode=1, stderr=error.encode()))
        self.assertIsNone(CraneRegistry(run=run).lookup(self.target))
        for text in ('403 DENIED', '404', 'network timeout', error.replace('MANIFEST_UNKNOWN', 'UNAUTHORIZED'),
                     error.replace('a' * 40, 'b' * 40), 'unauthorized\n' + error):
            with self.subTest(text=text):
                self.assertFalse(missing_manifest(text, self.target))
                run = Mock(return_value=SimpleNamespace(returncode=1, stderr=text.encode()))
                with self.assertRaisesRegex(ValueError, '^Registry operation failed; raw output withheld$'):
                    CraneRegistry(run=run).lookup(self.target)

    def test_manifest_absence_does_not_parse_status_codes_inside_source_sha(self):
        for digits in ('401', '403', '429', '500', '503', '599'):
            target = 'ghcr.io/chronoaiproject/ornn-api:' + digits + 'a' * 37
            suffix = ('GET https://ghcr.io/v2/chronoaiproject/ornn-api/manifests/'
                      + digits + 'a' * 37 + ': MANIFEST_UNKNOWN: manifest unknown')
            for error in (suffix, 'Error: ' + suffix,
                          'Error: fetching manifest ' + target + ': ' + suffix):
                with self.subTest(digits=digits, prefix=error[:20]):
                    self.assertTrue(missing_manifest(error, target))
            for prefix in ('HTTP 503 ', '401 ', 'Error: denied: ', 'unrecognized: '):
                self.assertFalse(missing_manifest(prefix + suffix, target))

    def test_crane_push_reference_and_full_pull_validation(self):
        self.extract()
        ref = self.target.rsplit(':', 1)[0] + '@' + self.digest
        run = Mock(return_value=SimpleNamespace(returncode=0, stdout=ref.encode()))
        self.assertEqual(CraneRegistry(run=run).push(self.layout, self.target), self.digest)
        run = Mock(return_value=SimpleNamespace(returncode=0, stdout=b'other/image@sha256:bad'))
        with self.assertRaises(ValueError):
            CraneRegistry(run=run).push(self.layout, self.target)
        def pulled(*args, **kwargs):
            shutil.copytree(self.layout, self.pulled)
            return SimpleNamespace(returncode=0, stdout=b'')
        CraneRegistry(run=pulled).verify(ref, self.pulled, self.manifest, self.digest, self.metadata)

    def test_scan_failure_prevents_extraction_or_registry_write(self):
        with patch.object(staging_publish, 'producer_environment', return_value={}), \
                patch.object(staging_publish.Path, 'read_text', return_value='{}'), \
                patch.object(staging_publish.subprocess, 'check_output', return_value='tree'), \
                patch.object(staging_publish, 'verify_archive', side_effect=ValueError('scan not clean')), \
                patch.object(staging_publish, 'extract_layout') as extract, \
                patch.object(staging_publish, 'publish_exact') as publish:
            with self.assertRaises(ValueError):
                staging_publish.main()
            extract.assert_not_called()
            publish.assert_not_called()

    def test_controller_emits_existing_receipt_inputs_after_verification(self):
        with tempfile.TemporaryDirectory() as temp:
            prior = Path.cwd()
            try:
                os.chdir(temp)
                Path('staging-image-out').mkdir()
                Path('staging-artifact.json').write_text(json.dumps({'artifactId': 789, 'buildAttempt': '1'}))
                metadata = {**self.metadata, 'archive': 'image.tar.gz'}
                with patch.dict(os.environ, {'COMPONENT': 'api', 'GITHUB_SHA': 'a' * 40,
                                              'GITHUB_RUN_ATTEMPT': '2'}), \
                        patch.object(staging_publish, 'producer_environment', return_value={}), \
                        patch.object(staging_publish.subprocess, 'check_output', return_value='tree'), \
                        patch.object(staging_publish, 'verify_archive', return_value=metadata), \
                        patch.object(staging_publish, 'extract_layout', return_value=(self.manifest, self.digest)), \
                        patch.object(staging_publish, 'publish_exact', return_value='reused'):
                    staging_publish.main()
                out = Path('staging-image-out')
                self.assertEqual((out / 'push-digest.txt').read_text().strip(), self.digest)
                self.assertEqual(json.loads((out / 'remote-manifest.json').read_text()), self.manifest)
                action = json.loads((out / 'publication-action.json').read_text())
                self.assertEqual(action['action'], 'reused')
                self.assertEqual(action['buildAttempt'], '1')
                self.assertEqual(action['publicationAttempt'], '2')
            finally:
                os.chdir(prior)


if __name__ == '__main__':
    unittest.main()
