import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from symlink_support import require_symlinks
from scripts.radiomics_manifest import *
from scripts.prepare_radiomics_web import validate_config

WORKSPACE = Path(__file__).resolve().parents[1]


def fixture():
    c = {'id': 'case_900', 'sliceCount': 1, 'defaultSlice': 0, 'dimensions': [2, 3, 1], 'spacing': [1, 2, 3], 'gtVoxelCount': 1,
         'metrics': {'reviewGroup': 1, 'reviewGroupBin50': 1, 'largestComponentMl': .006, 'componentCount': 1, 'maxDiameterMm': 3, 'sphericity': .5, 'entropy': 0, 'contrastHu': 0}, 'slices': []}
    c['slices'] = [{'index': 0, 'ct': 'data/radiomics_web/web/case_900/ct/0000.webp', 'gt': 'data/radiomics_web/web/case_900/gt/0000.png', 'ctSha256': sha256(b'ct'), 'gtSha256': sha256(b'gt'), 'gtPixels': 1, 'width': 2, 'height': 3}]
    return {'version': 1, 'localOnly': True, 'caseCount': 1, 'windowHu': [-150, 250], 'cases': [c]}


def write_fixture(root):
    m = fixture()
    for k in ('ct', 'gt'):
        p = root / m['cases'][0]['slices'][0][k]
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(k.encode())
    (root / MANIFEST).write_text(json.dumps(m))
    return m


class ContractTests(unittest.TestCase):
    def test_valid_and_zero_preserved(self):
        self.assertEqual(validate_manifest(fixture())['cases'][0]['metrics']['entropy'], 0)

    def test_negative_controls(self):
        changes = [lambda m: m.update(privatePath='secret'), lambda m: m.update(caseCount=True),
                   lambda m: m['cases'][0].update(id='case_900/../x'), lambda m: m['cases'][0].update(defaultSlice=1),
                   lambda m: m['cases'][0].update(gtVoxelCount=2), lambda m: m['cases'][0]['metrics'].update(entropy=float('nan')),
                   lambda m: m['cases'][0]['metrics'].update(contrastHu=-1), lambda m: m['cases'][0]['metrics'].update(reviewGroup=2),
                   lambda m: m['cases'][0]['slices'][0].update(ct='../raw.nii'), lambda m: m['cases'][0]['slices'][0].update(width=3),
                   lambda m: m['cases'][0]['slices'][0].update(gtSha256='f'*63), lambda m: m['cases'][0]['slices'][0].update(index=False),
                   lambda m: m['cases'].append(copy.deepcopy(m['cases'][0]))]
        for mutate in changes:
            with self.subTest(mutate=mutate):
                m = fixture(); mutate(m)
                with self.assertRaises(ValueError): validate_manifest(m)
        for raw in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}'):
            with self.assertRaises(ValueError): parse_json(raw)

    def test_empty_annotation(self):
        m = fixture(); c = m['cases'][0]; c['gtVoxelCount'] = 0; c['slices'][0]['gtPixels'] = 0
        c['metrics'] = {k: None if k in NULLABLE else 0 for k in METRICS}
        validate_manifest(m)
        c['metrics']['entropy'] = 0
        with self.assertRaises(ValueError): validate_manifest(m)

    def test_hand_calculated_pareto(self):
        cases = []
        # A dominates B and D; C trades lower volume for more components; B dominates D.
        for i, axes in enumerate([(8, 2, 4, 2), (4, 1, 2, 4), (2, 3, 1, 6), (1, 1, 1, 8), (8, 2, 4, 2)]):
            cases.append({'id': f'case_{900+i}', 'metrics': dict(zip(['largestComponentMl', 'componentCount', 'entropy', 'contrastHu'], axes))})
        self.assertEqual(pareto_groups(cases), {'case_900': 1, 'case_902': 1, 'case_904': 1, 'case_901': 2, 'case_903': 3})
        self.assertEqual(pareto_groups(cases, True), pareto_groups(cases))

    def test_config_strictness(self):
        c = {'id': 'case_900', 'image': 'private.nii', 'mask': 'mask.nii', 'imageSha256': 'a'*64, 'maskSha256': 'b'*64, 'metrics': fixture()['cases'][0]['metrics']}
        config = {'version': 1, 'cases': [c]}; validate_config(config)
        c['header'] = 'private'
        with self.assertRaises(ValueError): validate_config(config)

    def test_snapshot_corruption_and_traversal(self):
        with tempfile.TemporaryDirectory(dir=WORKSPACE) as tmp:
            root = Path(tmp); m = write_fixture(root)
            raw, assets = build_snapshot(root); self.assertEqual(len(assets), 2)
            path = root / m['cases'][0]['slices'][0]['ct']; path.write_bytes(b'bad')
            with self.assertRaises(ValueError): build_snapshot(root)
            for rel in ('../x', '/x', 'data//x', 'data/./x', 'data\\x'):
                with self.assertRaises(ValueError): safe_file(root, rel)

    def test_real_symlink_file_and_ancestor(self):
        with tempfile.TemporaryDirectory(dir=WORKSPACE) as tmp:
            root = Path(tmp)
            require_symlinks(self, root)
            m = write_fixture(root)
            path = root / m['cases'][0]['slices'][0]['ct']
            path.unlink(); path.symlink_to(root / m['cases'][0]['slices'][0]['gt'])
            with self.assertRaises(ValueError): build_snapshot(root)
            path.unlink(); path.parent.rmdir(); path.parent.symlink_to(root / 'data/radiomics_web/web/case_900/gt', target_is_directory=True)
            with self.assertRaises(ValueError): safe_file(root, m['cases'][0]['slices'][0]['ct'])

    def test_mock_symlink_file_and_ancestor(self):
        with tempfile.TemporaryDirectory(dir=WORKSPACE) as tmp:
            root = Path(tmp); m = write_fixture(root)
            target = root / m['cases'][0]['slices'][0]['ct']
            real_is_symlink = Path.is_symlink
            for blocked in (target, target.parent, root / 'data'):
                with self.subTest(blocked=blocked.name):
                    def is_symlink(path):
                        return path == blocked or real_is_symlink(path)
                    with patch.object(Path, 'is_symlink', is_symlink):
                        with self.assertRaises(ValueError): build_snapshot(root)
                        with self.assertRaises(ValueError): safe_file(root, m['cases'][0]['slices'][0]['ct'])

if __name__ == '__main__': unittest.main()
