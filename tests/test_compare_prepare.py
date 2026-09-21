import io
import json
import copy
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

    def test_runtime_verification_recomputes_synthetic_masks_and_rejects_moved_candidate(self):
        # Miniature source cohort only replaces the fixed five-case schema gate.
        # Hash/geometry checks, image encoding/binding, full-mask comparison,
        # evidence equality and the production runtime verifier all run normally.
        from scripts.serve_integrated import verify_source_evidence
        from scripts.evidence_schema import validate
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            repo = Path(directory)
            (repo / 'scripts').mkdir()
            entries = []
            for kind in ('ct','gt',*prepare.MODELS):
                array = np.zeros((8,8,3), dtype=np.uint8)
                if kind != 'ct':
                    array[1 if kind != 'cp050' else 6, 1, 1] = 2
                path = repo / 'data/model_compare' / kind / 'case_900.nii.gz'
                path.parent.mkdir(parents=True, exist_ok=True)
                obj = nib.Nifti1Image(array, np.eye(4))
                nib.save(obj, str(path))
                entries.append({'id':'case_900','kind':kind,'local':f'{kind}/case_900.nii.gz',
                                'sha256':prepare.original.sha256(path),'shape':[8,8,3],
                                'affine':np.eye(4).tolist(),'spacing':[1,1,1],'orientation':'RAS',
                                'voxels2':int(np.count_nonzero(array == 2))})
            (repo / 'scripts/compare_sources.json').write_text(json.dumps(entries))
            with patch.object(prepare, 'CASES', {'case_900':(3,1)}), \
                    patch.object(prepare, 'validate_manifest'), patch('builtins.print'):
                original = prepare.build(repo=repo, evidence=True)
                self.assertEqual(verify_source_evidence(repo), original)
                manifest = json.loads((repo / 'data/model_compare/manifest.json').read_text())
                artifact = repo / 'data/model_compare/evidence.json'
                original_bytes = artifact.read_bytes()
                forged = copy.deepcopy(original)
                case = forged['cases']['case_900']
                candidate = case['models']['cp050']['candidates'][0]
                candidate.update(voxel=[5,1,1], bbox=[[5,5],[1,1],[1,1]])
                for reason in case['reasons']:
                    if reason['candidateId'] == 'cp050:1':
                        reason['voxel'] = [5,1,1]
                validate(forged, manifest, original['manifestSha256'])
                artifact.write_text(json.dumps(forged))
                with self.assertRaisesRegex(ValueError, 'full source masks'):
                    verify_source_evidence(repo)
                artifact.write_bytes(original_bytes)
                source = repo / 'data/model_compare/cp050/case_900.nii.gz'
                source.write_bytes(b'unapproved synthetic bytes')
                with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                    verify_source_evidence(repo)


if __name__ == '__main__': unittest.main()
