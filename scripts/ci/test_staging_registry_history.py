"""Package snapshots detect observable races without claiming an atomic tag lock."""

import copy
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from staging_registry_history import GithubPackageHistory, history_hash, parse_versions, verify_history

TARGET = 'ghcr.io/chronoaiproject/ornn-api:' + 'a' * 40
DIGEST = 'sha256:' + 'b' * 64
TAG = 'a' * 40


def version(digest=DIGEST, tags=None):
    return {'digest': digest, 'created': '2026-01-01T00:00:00Z',
            'updated': '2026-01-01T00:00:00Z', 'tags': [TAG] if tags is None else tags}


def response():
    return {'id': 1, 'name': DIGEST, 'created_at': '2026-01-01T00:00:00Z',
            'updated_at': '2026-01-01T00:00:00Z', 'metadata': {'container': {'tags': [TAG]}}}


class HistoryTests(unittest.TestCase):
    def test_snapshot_uses_readonly_paginated_gh_without_tokens_in_argv(self):
        run = Mock(return_value=SimpleNamespace(returncode=0, stdout=json.dumps([[response()]]).encode()))
        result = GithubPackageHistory(run).snapshot(TARGET)
        self.assertEqual(result, {1: version()})
        args = run.call_args.args[0]
        self.assertEqual(args, ['gh', 'api', '--method', 'GET',
                               'orgs/ChronoAIProject/packages/container/ornn-api/versions?per_page=100',
                               '--paginate', '--slurp'])
        self.assertEqual(len(history_hash(result)), 64)
        self.assertEqual(history_hash(result), history_hash(copy.deepcopy(result)))
        self.assertEqual(parse_versions([[]]), {})

    def test_invalid_target_api_errors_and_malformed_responses_fail_closed(self):
        run = Mock()
        with self.assertRaises(ValueError):
            GithubPackageHistory(run).snapshot('other/package:tag')
        run.assert_not_called()
        for status, data in ((1, b'PRIVATE_SENTINEL'), (0, b'not-json'), (0, b'{}'),
                             (0, b'x' * (32 * 1024 * 1024 + 1))):
            run = Mock(return_value=SimpleNamespace(returncode=status, stdout=data))
            with self.assertRaises(ValueError) as error:
                GithubPackageHistory(run).snapshot(TARGET)
            self.assertNotIn('PRIVATE_SENTINEL', str(error.exception))

    def test_incomplete_duplicate_and_invalid_history_never_becomes_empty(self):
        for key, value in (('id', True), ('name', 'PRIVATE_SENTINEL'),
                           ('created_at', 'not-a-time'), ('created_at', '2026-99-01T00:00:00Z'),
                           ('updated_at', '2025-01-01T00:00:00Z'), ('metadata', {})):
            record = response()
            record[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                parse_versions([[record]])
        for data in ([], {}, [None], [[response(), response()]], [[{}]],
                     [[response(), dict(response(), id=2)]]):
            with self.assertRaises(ValueError):
                parse_versions(data)
        for tags in ([TAG, TAG], ['bad/tag'], None, [1]):
            record = response()
            record['metadata']['container']['tags'] = tags
            with self.assertRaises(ValueError):
                parse_versions([[record]])

    def test_only_our_expected_version_change_is_permitted(self):
        other = version(digest='sha256:' + 'c' * 64, tags=['previous'])
        before = {2: other}
        after = {**before, 1: version()}
        verify_history(before, after, TARGET, DIGEST, 'published')
        verify_history(after, after, TARGET, DIGEST, 'reused')
        before = {1: version(tags=['existing-alias']), 2: other}
        after = {1: version(tags=sorted(['existing-alias', TAG])), 2: other}
        verify_history(before, after, TARGET, DIGEST, 'published')

    def test_competing_untagged_version_update_deletion_or_wrong_tag_fails(self):
        other = version(digest='sha256:' + 'c' * 64, tags=[])
        for before, after in (
            ({}, {}), ({}, {1: version(tags=[])}),
            ({}, {1: version(), 2: other}),
            ({2: other}, {1: version(), 2: dict(other, updated='2026-01-01T00:00:01Z')}),
            ({2: other}, {1: version()}),
            ({}, {1: version(), 2: dict(other, tags=[TAG])}),
            ({}, {1: version(tags=sorted([TAG, 'foreign-alias']))}),
            ({1: version()}, {1: version()}),
            ({1: version(tags=[])}, {1: dict(version(), created='2026-01-01T00:00:01Z')}),
        ):
            with self.subTest(before=before, after=after), self.assertRaises(ValueError):
                verify_history(before, after, TARGET, DIGEST, 'published')
        with self.assertRaises(ValueError):
            verify_history({}, {1: version()}, TARGET, DIGEST, 'reused')
        with self.assertRaises(ValueError):
            verify_history({}, {1: version()}, TARGET, DIGEST, 'invalid')

    def test_all_publish_events_share_one_non_cancelling_group_per_image(self):
        # The repository uses no YAML parser at runtime; assert the exact critical
        # job block without introducing a test-only dependency into native runners.
        workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/staging-native-images.yml').read_text()
        publish = workflow.split('\n  publish:\n', 1)[1]
        block = publish.split('    concurrency:\n', 1)[1].split('    permissions:\n', 1)[0]
        self.assertEqual(block, '      group: ornn-publish-${{ matrix.component }}\n'
                               '      cancel-in-progress: false\n')
        self.assertIn('          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}', publish)


if __name__ == '__main__':
    unittest.main()
