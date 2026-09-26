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
        planes = {}
        for kind, count in counts.items():
            plane, left, z = [0] * depth, count, 2
            while left and z < min(depth, 14):
                take = min(left, 512 * 512)
                plane[z] = take
                left -= take
                z += 1
            planes[kind] = plane
        stats = {}
        for kind, count in counts.items():
            hits = [i + 1 for i, n in enumerate(planes[kind]) if n]
            stats[kind] = {'voxels': count, 'volumeMl': count * .002,
                           'componentVolumesMl': [count * .002] if count else [], 'componentCount': 1 if count else 0,
                           'positiveSliceCount': len(hits), 'sliceSpan': [hits[0], hits[-1]] if hits else None}
        rows = []
        for z in range(depth):
            base = f'data/model_compare/web/{case_id}'
            rows.append({'index': z + 1, 'canonicalSlice': z, 'width': 512, 'height': 512,
                         'gtPixels': planes['gt'][z],
                         'ct': f'{base}/ct/{z + 1:03d}.webp', 'ctSha256': digest,
                         'overlays': {kind: {'path': f'{base}/{kind}/{z + 1:03d}.png', 'sha256': digest} for kind in counts},
                         'pixels': {kind: plane[z] for kind, plane in planes.items()}})
        cases.append({'id': case_id, 'sourceCaseId': case_id, 'sliceCount': depth, 'dimensions': [512, 512, depth],
                      'spacing': [1, 1, 2], 'tumorVolumeMl': stats['gt']['volumeMl'],
                      'defaultSlice': planes['gt'].index(max(planes['gt'])),
                      'gt': stats['gt'], 'models': {kind: stats[kind] for kind in counts if kind != 'gt'},
                      'disagreement': {'intersectionVoxels': 0, 'unionVoxels': sum(schema.MODEL_VOXELS[case_id]),
                                           'score': 1 if sum(schema.MODEL_VOXELS[case_id]) else 0} if case_id != 'case_045' else None,
                      'slices': rows})
    return {'version': schema.VERSION, 'localOnly': True, 'caseCount': len(schema.CASES), 'windowHu': [-150, 250], 'cases': cases}


class CompareServerTests(unittest.TestCase):
    def test_complete_schema_and_rejections(self):
        data = manifest()
        self.assertEqual(len(schema.validate_manifest(data)), 92401)
        # matched-r3: 12,055 slices x 5 planes, minus case_045 (74 slices, model overlays absent)
        # lv2-test20: 8,087 slices x 4 planes (CT+GT+2 arms; this run has no cp050)
        mutations = [lambda m: m.update(privatePath='private'), lambda m: m['cases'].reverse(),
                     lambda m: m['cases'][0]['models'].pop('cp050'),
                     lambda m: m['cases'][27]['models'].update(cp050=dict(m['cases'][27]['models']['baseline'])),
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
