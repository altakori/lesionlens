"""Comparison schema and serving tests using synthetic bytes, never source images."""
import copy
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import compare_manifest as schema
from scripts import serve_local as serve


def manifest():
    cases = []
    digest = hashlib.sha256(b'fixture').hexdigest()
    for case_id, (depth, voxels) in schema.CASES.items():
        counts = {'gt': voxels, **dict(zip(schema.MODELS, schema.MODEL_VOXELS.get(case_id, ())))}
        stats = {kind: {'voxels': count, 'volumeMl': count * .002, 'componentVolumesMl': [count * .002],
                        'componentCount': 1, 'positiveSliceCount': 1, 'sliceSpan': [3, 3]} for kind, count in counts.items()}
        rows = []
        for z in range(depth):
            base = f'data/model_compare/web/{case_id}'
            rows.append({'index': z + 1, 'canonicalSlice': z, 'width': 512, 'height': 512,
                         'gtPixels': voxels if z == 2 else 0,
                         'ct': f'{base}/ct/{z + 1:03d}.webp', 'ctSha256': digest,
                         'overlays': {kind: {'path': f'{base}/{kind}/{z + 1:03d}.png', 'sha256': digest} for kind in counts},
                         'pixels': {kind: count if z == 2 else 0 for kind, count in counts.items()}})
        cases.append({'id': case_id, 'sourceCaseId': case_id, 'sliceCount': depth, 'dimensions': [512, 512, depth],
                      'spacing': [1, 1, 2], 'tumorVolumeMl': stats['gt']['volumeMl'], 'defaultSlice': 2,
                      'gt': stats['gt'], 'models': {kind: stats[kind] for kind in counts if kind != 'gt'},
                      'disagreement': {'intersectionVoxels': 0, 'unionVoxels': sum(schema.MODEL_VOXELS[case_id]), 'score': 1} if case_id != 'case_045' else None,
                      'slices': rows})
    return {'version': schema.VERSION, 'localOnly': True, 'caseCount': 5, 'windowHu': [-150, 250], 'cases': cases}


class CompareServerTests(unittest.TestCase):
    def test_complete_schema_and_rejections(self):
        data = manifest()
        self.assertEqual(len(schema.validate_manifest(data)), 2978)
        mutations = [lambda m: m.update(privatePath='private'), lambda m: m['cases'].reverse(),
                     lambda m: m['cases'][0]['models'].pop('cp050'),
                     lambda m: m['cases'][3]['models'].update(baseline=m['cases'][0]['gt']),
                     lambda m: m['cases'][3].update(disagreement={'score': 0}),
                     lambda m: m['cases'][0]['slices'][0]['overlays']['baseline'].update(path='../source.nii.gz'),
                     lambda m: m['cases'][0]['slices'][0]['overlays']['baseline'].update(sha256='x' * 64),
                     lambda m: m['cases'][0]['slices'][0]['pixels'].update(baseline=True),
                     lambda m: m['cases'][0]['gt'].update(componentCount=2),
                     lambda m: m['cases'][0]['gt'].update(componentVolumesMl=[-1]),
                     lambda m: m['cases'][0]['gt'].update(positiveSliceCount=2),
                     lambda m: m['cases'][0]['gt'].update(sliceSpan=[1, 3]),
                     lambda m: m['cases'][0]['disagreement'].update(score=.5),
                     lambda m: m['cases'][0]['disagreement'].update(unionVoxels=1),
                     lambda m: m['cases'][0].update(defaultSlice=0),
                     lambda m: m['cases'][0].update(spacing=[1, 1, float('nan')]),
                     lambda m: m['cases'][0]['models']['baseline'].update(volumeMl=99)]
        for mutate in mutations:
            changed = copy.deepcopy(data); mutate(changed)
            with self.assertRaises(ValueError): schema.validate_manifest(changed)

    def test_snapshot_requested_bytes_routes_and_symlinks(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory).absolute()
            data = manifest()
            manifest_path = root / schema.MANIFEST[1:]
            manifest_path.parent.mkdir(parents=True)
            manifest_path.write_text(json.dumps(data))
            assets = schema.validate_manifest(data)
            for relative in assets:
                path = root / relative[1:]; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'fixture')
            content, hashes = serve.build_compare_snapshot(root)
            handler = object.__new__(serve.CompareHandler)
            handler.directory = str(root); handler.manifest_content = content; handler.asset_hashes = hashes
            for route in ['/', '/app.js?v=3', schema.MANIFEST, next(iter(assets))]:
                handler.path = route; self.assertTrue(handler._allowed())
            for route in ['/data/capp_cases/manifest.json', '/data/real_cases/manifest.json', '/data/model_compare/baseline/case_000.nii.gz',
                          '/scripts/compare_sources.json', '/data/model_compare/receipt.json', '/.git/config', '/.env',
                          '/%2e%2e/app.js', '/%5capp.js', '/data/model_compare/web/../manifest.json', '/data/model_compare/web/']:
                handler.path = route; self.assertFalse(handler._allowed(), route)
            # Snapshot stays unchanged when manifest bytes change after startup.
            manifest_path.write_text('{}')
            handler.path = schema.MANIFEST; handler.wfile = io.BytesIO()
            handler.send_response = lambda value: self.assertEqual(value, 200)
            handler.send_header = lambda *args: None; handler.end_headers = lambda: None
            handler._serve(); self.assertEqual(handler.wfile.getvalue(), content)
            rejected = []; handler._reject = lambda: rejected.append(True)
            target = root / next(iter(hashes))[1:]; target.write_bytes(b'tampered')
            handler.path = next(iter(hashes)); handler._serve(); self.assertEqual(rejected, [True])
            manifest_path.write_bytes(content)
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): serve.build_compare_snapshot(root)
            for linked in (target, target.parent, manifest_path):
                handler.path = schema.MANIFEST if linked == manifest_path else next(iter(hashes))
                with patch.object(Path, 'is_symlink', lambda candidate: candidate == linked):
                    before = len(rejected); handler._serve(); self.assertEqual(len(rejected), before + 1)

    def test_missing_manifest_ui_only(self):
        handler = object.__new__(serve.CompareHandler)
        handler.manifest_content = None; handler.asset_hashes = {}
        handler.path = schema.MANIFEST; self.assertFalse(handler._allowed())
        handler.path = '/'; self.assertTrue(handler._allowed())


if __name__ == '__main__': unittest.main()
