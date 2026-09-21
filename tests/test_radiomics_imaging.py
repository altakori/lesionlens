import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from scripts.prepare_radiomics_web import export, load_case, source_hash, slice_pixels, encode
from test_radiomics_manifest import WORKSPACE, fixture

AVAILABLE = all(importlib.util.find_spec(x) for x in ('numpy', 'nibabel', 'PIL', 'scipy'))


@unittest.skipUnless(AVAILABLE, 'Parent must supply numpy, nibabel, Pillow and scipy')
class ImagingTests(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import nibabel as nib
        self.tmp = tempfile.TemporaryDirectory(dir=WORKSPACE); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.ct = np.arange(24, dtype=np.float32).reshape(2, 3, 4) * 20 - 200
        self.gt = np.zeros((2, 3, 4), dtype=np.uint8); self.gt[0, 2, 1] = 2; self.gt[1, 0, 3] = 2
        self.affine = np.diag([-2., -3., 4., 1.]); self.affine[:3, 3] = [10, 20, 30]
        self.c = {'id': 'case_900', 'image': 'image.nii', 'mask': 'mask.nii', 'metrics': fixture()['cases'][0]['metrics'].copy()}
        self.c['metrics'].update(componentCount=2, largestComponentMl=.024)
        self.save()

    def save(self, mask_affine=None):
        import nibabel as nib
        for key, data, affine in [('image', self.ct, self.affine), ('mask', self.gt, self.affine if mask_affine is None else mask_affine)]:
            nib.save(nib.Nifti1Image(data, affine), self.root / self.c[key])
            self.c[key + 'Sha256'] = source_hash(self.root / self.c[key])
        (self.root / 'local.json').write_text(json.dumps({'version': 1, 'cases': [self.c]}))

    def test_orientation_and_roundtrip(self):
        import numpy as np
        ct, gt, spacing = load_case(self.c, self.root)
        self.assertEqual(spacing, [2, 3, 4])
        self.assertEqual(ct.dtype, np.dtype('float32')); self.assertEqual(gt.dtype, np.dtype('bool'))
        self.assertTrue(np.array_equal(ct, self.ct[::-1, ::-1, :]))
        gray, rgba = slice_pixels(ct, gt, 1)
        self.assertEqual(gray.shape, (3, 2)); self.assertEqual(rgba[2, 0].tolist(), [170, 70, 230, 150])
        expected = np.rint((np.clip(self.ct[:, :, 1].T, -150, 250) + 150) * 255 / 400).astype(np.uint8)
        np.testing.assert_array_equal(gray, expected)
        export(self.root / 'local.json', self.root)
        before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.root.rglob('*') if p.is_file()}
        export(self.root / 'local.json', self.root, True)
        self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in before})
        manifest = json.loads((self.root / 'data/radiomics_web/manifest.json').read_text())
        self.assertEqual(manifest['cases'][0]['defaultSlice'], 1)
        from PIL import Image
        exported_slice = self.root / manifest['cases'][0]['slices'][1]['ct']
        with Image.open(exported_slice) as image:
            previous_pixel = image.convert('L').getpixel((1, 1))
        # Independent oracle: 140 HU -> round(290*255/400)=185;
        # 160 HU -> round(310*255/400)=198. Both are inside the window.
        self.assertEqual(float(self.ct[1, 1, 1]), 140)
        self.assertEqual(previous_pixel, 185)
        self.ct[1, 1, 1] += 20; self.save()
        updated_ct, updated_gt, _ = load_case(self.c, self.root)
        updated_gray, _ = slice_pixels(updated_ct, updated_gt, 1)
        self.assertEqual(int(updated_gray[1, 1]), 198)
        self.assertNotEqual(previous_pixel, int(updated_gray[1, 1]))
        with self.assertRaises(ValueError): export(self.root / 'local.json', self.root, True)

    def test_source_change_without_config_refresh_is_rejected(self):
        import nibabel as nib
        export(self.root / 'local.json', self.root)
        config_before = (self.root / 'local.json').read_bytes()
        expected_hash = self.c['imageSha256']
        # Even a change entirely below the display window must fail the source
        # hash check when the approved config has not been refreshed.
        self.ct[0, 0, 0] += 20  # -200 -> -180; both display as zero.
        nib.save(nib.Nifti1Image(self.ct, self.affine), self.root / self.c['image'])
        self.assertNotEqual(source_hash(self.root / self.c['image']), expected_hash)
        self.assertEqual(self.c['imageSha256'], expected_hash)
        self.assertEqual((self.root / 'local.json').read_bytes(), config_before)
        with self.assertRaises(ValueError): load_case(self.c, self.root)
        with self.assertRaises(ValueError): export(self.root / 'local.json', self.root, True)

    def test_fast_lossless_webp_preserves_every_gray_value(self):
        import io
        import numpy as np
        from PIL import Image
        pixels = np.arange(256, dtype=np.uint8).reshape(16, 16)
        encoded = encode(pixels, 'WEBP')
        with Image.open(io.BytesIO(encoded)) as image:
            self.assertEqual(image.format, 'WEBP')
            decoded = np.asarray(image.convert('RGBA'))
        expected = np.empty((16, 16, 4), dtype=np.uint8)
        expected[:, :, :3] = pixels[:, :, None]
        expected[:, :, 3] = 255
        np.testing.assert_array_equal(decoded, expected)

    def test_axis_permutation_is_canonical(self):
        import numpy as np
        self.affine = np.array([[0., 0., 4., 10.], [2., 0., 0., 20.], [0., -3., 0., 30.], [0., 0., 0., 1.]])
        self.save()
        ct, gt, spacing = load_case(self.c, self.root)
        self.assertEqual(ct.shape, (4, 2, 3)); self.assertEqual(spacing, [4, 2, 3])
        np.testing.assert_array_equal(ct, self.ct.transpose(2, 0, 1)[:, :, ::-1])
        gray, rgba = slice_pixels(ct, gt, 0)
        self.assertEqual(gray.shape, (2, 4))
        self.assertEqual(rgba[1, 2].tolist(), [170, 70, 230, 150])

    def test_diagonal_contact_uses_26_neighbors(self):
        import numpy as np
        from scipy import ndimage
        self.ct = np.zeros((3, 3, 3), dtype=np.float32)
        self.gt = np.zeros((3, 3, 3), dtype=np.uint8)
        self.gt[0, 0, 0] = 2; self.gt[1, 1, 1] = 2
        self.affine = np.diag([2., 3., 4., 1.])
        binary = self.gt == 2
        self.assertEqual(ndimage.label(binary, ndimage.generate_binary_structure(3, 1))[1], 2)
        self.assertEqual(ndimage.label(binary, ndimage.generate_binary_structure(3, 3))[1], 1)
        # Hand calculated: 2 * (2*3*4 mm^3) / 1000 = .048 mL.
        self.c['metrics'].update(componentCount=1, largestComponentMl=.048)
        self.save()
        load_case(self.c, self.root)
        export(self.root / 'local.json', self.root)
        export(self.root / 'local.json', self.root, True)
        self.c['metrics'].update(componentCount=2, largestComponentMl=.024)
        with self.assertRaises(ValueError): load_case(self.c, self.root)
        self.c['metrics'].update(componentCount=1, largestComponentMl=.024)
        with self.assertRaises(ValueError): load_case(self.c, self.root)

    def test_fractional_float64_mask_cannot_round_into_valid_label(self):
        import numpy as np
        self.gt = self.gt.astype(np.float64)
        self.gt[0, 0, 0] = 1.0000000001
        self.save()
        with self.assertRaises(ValueError): load_case(self.c, self.root)

    def test_returned_arrays_detached_from_source(self):
        import numpy as np
        ct, gt, _ = load_case(self.c, self.root)
        for array in (ct, gt):
            self.assertIs(type(array), np.ndarray)
            self.assertIsNone(array.base)
            self.assertTrue(array.flags.owndata)
        expected_ct, expected_gt = ct.copy(), gt.copy()
        self.ct[:] = 100; self.gt[:] = 0
        # Keep both returned arrays alive while overwriting the same .nii files.
        # Windows fails here if either array still retains a file mapping.
        self.save()
        np.testing.assert_array_equal(ct, expected_ct)
        np.testing.assert_array_equal(gt, expected_gt)

    def test_invalid_sources(self):
        import numpy as np
        for bad in (np.nan, np.inf):
            self.ct[0, 0, 0] = bad; self.save()
            with self.assertRaises(ValueError): load_case(self.c, self.root)
        self.ct[0, 0, 0] = 0
        self.gt[0, 0, 0] = 3; self.save()
        with self.assertRaises(ValueError): load_case(self.c, self.root)
        self.gt[0, 0, 0] = 0
        affine = self.affine.copy(); affine[0, 3] += .1; self.save(affine)
        with self.assertRaises(ValueError): load_case(self.c, self.root)
        self.save(); self.c['imageSha256'] = '0'*64
        with self.assertRaises(ValueError): load_case(self.c, self.root)
        self.save(); self.c['metrics']['componentCount'] = 1
        with self.assertRaises(ValueError): load_case(self.c, self.root)
        self.c['metrics']['componentCount'] = 2; self.c['metrics']['largestComponentMl'] = 99
        with self.assertRaises(ValueError): load_case(self.c, self.root)

    def test_scipy_is_required_even_for_empty_annotation(self):
        import builtins
        from unittest.mock import patch
        self.gt[:] = 0
        self.c['metrics'] = {k: (0 if k in ('componentCount', 'largestComponentMl') else None) for k in self.c['metrics']}
        self.save()
        original_import = builtins.__import__
        def without_scipy(name, *args, **kwargs):
            if name == 'scipy' or name.startswith('scipy.'):
                raise ImportError('synthetic missing dependency')
            return original_import(name, *args, **kwargs)
        with patch('builtins.__import__', side_effect=without_scipy):
            with self.assertRaisesRegex(ValueError, 'SciPy required'):
                load_case(self.c, self.root)

    def test_empty_annotation_midpoint(self):
        self.gt[:] = 1  # non-tumor annotation is not GT label 2
        self.c['metrics'] = {k: (0 if k in ('componentCount', 'largestComponentMl') else None) for k in self.c['metrics']}
        self.save()
        export(self.root / 'local.json', self.root)
        m = json.loads((self.root / 'data/radiomics_web/manifest.json').read_text())
        self.assertEqual(m['cases'][0]['gtVoxelCount'], 0)
        self.assertEqual(m['cases'][0]['defaultSlice'], 2)
        export(self.root / 'local.json', self.root, True)

    def test_mask_values_shape_and_geometry(self):
        import numpy as np
        import nibabel as nib
        self.gt = self.gt.astype(np.float32)
        for bad in (.5, np.nan, np.inf, -1):
            self.gt[0, 0, 0] = bad; self.save()
            with self.assertRaises(ValueError): load_case(self.c, self.root)
        self.gt[0, 0, 0] = 0
        self.gt = self.gt[:, :, :3]; self.save()
        with self.assertRaises(ValueError): load_case(self.c, self.root)
        self.gt = np.zeros_like(self.ct, dtype=np.uint8); self.gt[0, 2, 1] = 2; self.gt[1, 0, 3] = 2
        self.affine[0, 1] = .2; self.save()
        with self.assertRaises(ValueError): load_case(self.c, self.root)
        self.affine[0, 1] = 0; self.save()
        image = nib.load(self.root / 'image.nii')
        image.header.set_xyzt_units('meter')
        nib.save(image, self.root / 'wrongunits.nii')
        self.c['image'] = 'wrongunits.nii'; self.c['imageSha256'] = source_hash(self.root / 'wrongunits.nii')
        with self.assertRaises(ValueError): load_case(self.c, self.root)

    def test_failed_export_does_not_publish_manifest(self):
        import copy
        export(self.root / 'local.json', self.root)
        path = self.root / 'data/radiomics_web/manifest.json'; before = path.read_bytes()
        broken = copy.deepcopy(self.c); broken['id'] = 'case_901'; broken['maskSha256'] = '0' * 64
        (self.root / 'local.json').write_text(json.dumps({'version': 1, 'cases': [self.c, broken]}))
        with self.assertRaises(ValueError): export(self.root / 'local.json', self.root)
        self.assertEqual(path.read_bytes(), before)

if __name__ == '__main__': unittest.main()
