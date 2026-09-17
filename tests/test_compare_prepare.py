import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import nibabel as nib
import numpy as np
from PIL import Image
from scripts import prepare_model_compare as prepare


class ComparePrepareTests(unittest.TestCase):
    def test_26_connectivity_component_volume_and_slice_span(self):
        mask = np.zeros((5, 5, 5), dtype=bool)
        mask[0, 0, 0] = mask[1, 1, 1] = mask[4, 4, 4] = True
        self.assertEqual(prepare.mask_stats(mask, .2), {'voxels': 3, 'volumeMl': 3 * .2,
            'componentVolumesMl': [.4, .2], 'componentCount': 2, 'positiveSliceCount': 3, 'sliceSpan': [1, 5]})
        empty = prepare.mask_stats(np.zeros_like(mask), .2)
        self.assertEqual(empty['sliceSpan'], None); self.assertEqual(empty['componentCount'], 0)

    def test_disagreement_measures_models_only_and_handles_empty_union(self):
        a = np.array([True, True, False]); b = np.array([True, False, True])
        self.assertEqual(prepare.disagreement([a, a, b]), {'intersectionVoxels': 1, 'unionVoxels': 3, 'score': 1 - 1 / 3})
        self.assertEqual(prepare.disagreement([a, a, a])['score'], 0)
        self.assertEqual(prepare.disagreement([a & False] * 3)['score'], 0)

    def test_asymmetric_orientation_all_overlays_and_ct_window(self):
        plane = np.full((5, 5), -150., dtype=np.float32)
        plane[4, 2] = 500; plane[2, 4] = 50
        ct = np.asarray(Image.open(io.BytesIO(prepare.encode_plane(plane, 'ct'))).convert('L'))
        self.assertEqual(ct[2, 0], 255); self.assertEqual(ct[0, 2], 127); self.assertEqual(ct[2, 4], 0)
        mask = np.zeros((5, 5), dtype=bool); mask[4, 2] = True
        for kind in ('gt', *prepare.MODELS):
            pixels = np.asarray(Image.open(io.BytesIO(prepare.encode_plane(mask, kind))))
            self.assertEqual(pixels[2, 0, 3], 160); self.assertEqual(np.count_nonzero(pixels[:, :, 3]), 1)

    def test_source_identity_and_geometry_and_invalid_values(self):
        obj = nib.Nifti1Image(np.zeros((2, 3, 4), dtype=np.float32), np.eye(4))
        entry = {'local': 'baseline/case_000.nii.gz', 'sha256': 'a' * 64, 'kind': 'baseline',
                 'shape': [2, 3, 4], 'affine': np.eye(4).tolist(), 'spacing': [1, 1, 1], 'orientation': 'RAS', 'voxels2': 0}
        prepare.validate_source(obj, entry)
        for key, value in [('shape', [2, 3, 5]), ('spacing', [2, 1, 1]), ('orientation', 'LAS'), ('voxels2', 1)]:
            with self.assertRaises(ValueError): prepare.validate_source(obj, {**entry, key: value})
        for value in (3, float('nan')):
            invalid = nib.Nifti1Image(np.full((2, 3, 4), value, dtype=np.float32), np.eye(4))
            with self.assertRaises(ValueError): prepare.validate_source(invalid, entry)
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory); path = root / entry['local']; path.parent.mkdir(); path.write_bytes(b'unapproved')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): prepare.load_source(root, entry)

    def test_exact_alignment_and_shared_ras_canonicalization(self):
        affine = np.diag([-1., 1., 2., 1.])
        ct = nib.Nifti1Image(np.zeros((2, 3, 4), dtype=np.float32), affine)
        mask = np.zeros((2, 3, 4), dtype=np.uint8); mask[0, 0, 0] = 2
        gt = nib.Nifti1Image(mask, affine)
        arrays, spacing, volume = prepare.canonical_arrays({'ct': ct, 'gt': gt, 'baseline': gt})
        self.assertTrue(arrays['gt'][1, 0, 0]); self.assertTrue(np.array_equal(arrays['gt'], arrays['baseline']))
        self.assertEqual(spacing, [1, 1, 2]); self.assertEqual(volume, .002)
        shifted = affine.copy(); shifted[0, 3] = 1e-7
        with self.assertRaisesRegex(ValueError, 'exact'):
            prepare.canonical_arrays({'ct': ct, 'gt': nib.Nifti1Image(mask, shifted)})


if __name__ == '__main__': unittest.main()
