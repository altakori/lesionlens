import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import nibabel as nib
import numpy as np
from PIL import Image
from scripts import prepare_capp_cases as prepare


class CappPrepareTests(unittest.TestCase):
    def test_radiological_orientation_asymmetric_markers(self):
        # Input axes are R,A. Distinct markers at R+ and A+ prove orientation.
        ct = np.full((5, 5), -150., dtype=np.float32)
        gt = np.zeros((5, 5), dtype=np.uint8)
        ct[4, 2] = 250; gt[4, 2] = 2  # right -> left-middle
        ct[2, 4] = 50                 # anterior -> top-middle
        encoded_ct, encoded_gt = prepare.encode_slice(ct, gt)
        pixels = np.asarray(Image.open(io.BytesIO(encoded_ct)).convert('L'))
        overlay = np.asarray(Image.open(io.BytesIO(encoded_gt)))
        self.assertEqual(int(pixels[2, 0]), 255)
        self.assertEqual(int(pixels[0, 2]), 127)
        self.assertEqual(int(pixels[2, 4]), 0)
        self.assertEqual(int(overlay[2, 0, 3]), 160)
        self.assertEqual(np.count_nonzero(overlay[:, :, 3]), 1)

    def test_source_identity_rejects_unapproved_bytes(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            for folder, filename in [('imagesTr', 'case_000_0000.nii.gz'), ('labelsTr', 'case_000.nii.gz')]:
                path = root / 'source' / folder / filename
                path.parent.mkdir(parents=True); path.write_bytes(b'not medical data')
            with self.assertRaisesRegex(ValueError, 'source hash mismatch'):
                prepare.validate_source_identity(root, 'case_000')

    def test_effective_geometry_allows_expected_qform_code_difference(self):
        affine = np.diag([-1., 1., 2., 1.])
        data = np.broadcast_to(np.uint8(0), (512, 512, 75))
        image, label = [nib.Nifti1Image(data, affine) for _ in range(2)]
        image.set_qform(affine, 1); label.set_qform(affine, 2)
        image.set_sform(affine, 1); label.set_sform(affine, 1)
        prepare.validate_geometry(image, label, 'case_000')
        shifted = affine.copy(); shifted[0, 3] = 3
        label.set_sform(shifted, 1)
        with self.assertRaisesRegex(ValueError, 'affine mismatch'):
            prepare.validate_geometry(image, label, 'case_000')

    def test_canonical_pair_rejects_non_label_values(self):
        image = nib.Nifti1Image(np.zeros((2, 3, 4), dtype=np.float32), np.eye(4))
        label = nib.Nifti1Image(np.full((2, 3, 4), 3, dtype=np.uint8), np.eye(4))
        with patch.object(prepare, 'validate_geometry'):
            with self.assertRaisesRegex(ValueError, 'invalid label'):
                prepare.canonical_pair(image, label, 'case_000')


if __name__ == '__main__':
    unittest.main()
