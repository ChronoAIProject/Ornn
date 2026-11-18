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
