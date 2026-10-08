import tempfile
import unittest
from pathlib import Path

import numpy as np

from backend import engine

ROOT = Path(__file__).resolve().parents[1]


class UnicodePathTests(unittest.TestCase):
    def test_same_results_in_ascii_and_korean_paths(self):
        rng = np.random.default_rng(42)
        counts = rng.negative_binomial(15, .15, (160, 8)) + 10
        counts[:15, 4:] *= 3
        features = ['gene' + str(i) for i in range(len(counts))]
        samples = [{'id': 'GSM' + str(i), 'group': 'Group A' if i < 4 else 'Group B', 'subject': str(i % 4)} for i in range(8)]
        with tempfile.TemporaryDirectory(dir=ROOT / '.local') as temp:
            base = Path(temp)
            for unit, transform, blocking in [('raw_count', False, ['subject']), ('RPKM', True, [])]:
                with self.subTest(unit=unit, transform=transform):
                    ascii_result = engine.run_r(ROOT, base / 'ascii' / unit, counts, features, samples, unit, blocking, transform)
                    korean_work = base / '노제 한글 경로' / unit
                    korean_result = engine.run_r(ROOT, korean_work, counts, features, samples, unit, blocking, transform)
                    np.testing.assert_allclose(korean_result[0], ascii_result[0], rtol=1e-12)
                    if not transform:
                        self.assertEqual(list(korean_result[1]['feature_id']), list(ascii_result[1]['feature_id']))
                        np.testing.assert_allclose(korean_result[1][['logFC', 'P.Value', 'adj.P.Val']], ascii_result[1][['logFC', 'P.Value', 'adj.P.Val']], rtol=1e-12)
                    self.assertTrue((korean_work / 'environment.txt').is_file())


if __name__ == '__main__':
    unittest.main(verbosity=2)
