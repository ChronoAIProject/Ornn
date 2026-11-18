import unittest

from staging_api_layer_proof import compare


class LayerComparisonTests(unittest.TestCase):
    def setUp(self):
        self.first = [{"digest": "base", "bytes": 250000000},
                      {"digest": "deps", "bytes": 20000000},
                      {"digest": "app-one", "bytes": 2500000}]
        self.second = [*self.first[:-1], {"digest": "app-two", "bytes": 2501000}]

    def test_only_application_change_passes(self):
        self.assertEqual(compare(self.first, self.second)["shared_bytes"], 270000000)

    def test_runtime_change_fails(self):
        self.second[0] = {"digest": "changed-base", "bytes": 250000000}
        with self.assertRaises(ValueError):
            compare(self.first, self.second)

    def test_unchanged_or_flattened_image_fails(self):
        for first, second in [(self.first, self.first), (self.first[-1:], self.second[-1:])]:
            with self.assertRaises(ValueError):
                compare(first, second)

    def test_oversized_app_layer_fails(self):
        self.second[-1]["bytes"] = 10000000
        with self.assertRaises(ValueError):
            compare(self.first, self.second)


class LayerScanParityTests(unittest.TestCase):
    def test_changed_finding_cannot_hide_behind_cache_hits(self):
        from staging_api_layer_scan_proof import check_parity
        fresh = {"complete": True, "findings": [{"rule": "new-value"}]}
        warm = {"complete": True, "findings": [],
                "detector_cache": {"hits": 9000, "misses": 1, "invalid": 0}}
        with self.assertRaises(ValueError):
            check_parity(warm, fresh, 8000)

    def test_complete_equality_still_requires_hits_and_new_app_scan(self):
        from staging_api_layer_scan_proof import check_parity
        fresh = {"complete": True, "findings": []}
        for hits, misses in [(7999, 1), (9000, 0)]:
            warm = {**fresh, "detector_cache": {"hits": hits, "misses": misses, "invalid": 0}}
            with self.assertRaises(ValueError):
                check_parity(warm, fresh, 8000)
        warm = {**fresh, "detector_cache": {"hits": 9000, "misses": 1, "invalid": 0}}
        self.assertEqual(check_parity(warm, fresh, 8000)["hits"], 9000)
