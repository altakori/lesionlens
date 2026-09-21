import unittest
import copy
try:
    import numpy as np
    from scripts.candidate_evidence import compare
except ImportError:
    np = None


@unittest.skipIf(np is None, 'numpy/scipy unavailable; install approved offline dependencies')
class CandidateEvidenceTests(unittest.TestCase):
    def mask(self, points):
        a = np.zeros((10, 10, 10), dtype=bool)
        for p in points:
            a[p] = True
        return a

    def test_equal_counts_different_locations(self):
        e = compare({'cappyv2': self.mask([(1,1,1)]), 'cp050': self.mask([(8,8,8)])}, .01)
        self.assertEqual([m['componentCount'] for m in e['models'].values()], [1,1])
        self.assertEqual(len(e['reasons']), 2)
        self.assertFalse(any(r['smallAdditional'] for r in e['reasons']), 'a sole small candidate is not additional')
        self.assertEqual(e['reasons'][0]['voxel'], [1,1,1])
        self.assertEqual(e['missingModels'], ['baseline'])

    def test_split_merge_unequal_counts_overlapping_matches(self):
        split = self.mask([(1,1,1),(1,1,5)])
        merged = self.mask([(1,1,z) for z in range(1,6)])
        for masks in ({'cappyv2':split,'cp050':merged},{'cappyv2':merged,'cp050':split}):
            e = compare(masks,.01)
            self.assertEqual(len(e['pairs'][0]['matches']),2)
            self.assertEqual([r['kind'] for r in e['reasons']],['split-merge'])
            self.assertFalse(e['reasons'][0]['smallAdditional'])
            self.assertEqual(sorted(m['componentCount'] for m in e['models'].values()),[1,2])

    def test_small_additional_requires_larger_main_in_same_model(self):
        main = [(1,1,1),(1,1,2)]
        a = self.mask(main + [(8,8,8)])
        e = compare({'cappyv2':a,'cp050':self.mask(main)},.01)
        self.assertEqual(len(e['reasons']),1)
        self.assertTrue(e['reasons'][0]['smallAdditional'])
        self.assertEqual(e['reasons'][0]['voxel'],[8,8,8])

    def test_missing_is_not_negative_and_gt_excluded(self):
        a = self.mask([(1,1,1)])
        e = compare({'cappyv2':a, 'gt':~a}, .5)
        self.assertEqual(e['reasons'],[])
        self.assertEqual(list(e['models']),['cappyv2'])
        self.assertEqual(e['models']['cappyv2']['totalVolumeMl'],.5)
        self.assertEqual(compare({},1)['missingModels'],['cappyv2','cp050','baseline'])
        with self.assertRaises(ValueError):
            compare({'cappyv2':a,'baseline':np.zeros((2,2,2))},1)

    def test_full_depth_small_threshold_and_empty_available(self):
        a = self.mask([(1,1,0),(8,8,9)])
        e = compare({'cappyv2':a,'baseline':self.mask([])},1.01)
        self.assertEqual(e['models']['cappyv2']['componentCount'],2)
        self.assertEqual(e['models']['baseline']['componentCount'],0)
        self.assertEqual({r['slice'] for r in e['reasons']},{0,9})
        self.assertFalse(any(r['smallAdditional'] for r in e['reasons']))
        self.assertAlmostEqual(e['models']['cappyv2']['totalVolumeMl'],2.02)

if __name__ == '__main__':
    unittest.main()
