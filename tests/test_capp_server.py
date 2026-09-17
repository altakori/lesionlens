"""Code-only safety tests: fixtures are bytes, never medical source files."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import serve_local as serve


def manifest():
    cases = []
    for case_id, (depth, voxels) in serve.CAPP_CASES.items():
        rows = []
        for z in range(depth):
            row = dict(index=z + 1, canonicalSlice=z, width=512, height=512, gtPixels=voxels if z == 2 else 0)
            for key, ext in (('ct', 'webp'), ('overlay', 'png')):
                row[key] = f'data/capp_cases/web/{case_id}/{key}/{z + 1:03d}.{ext}'
                row[key + 'Sha256'] = hashlib.sha256(b'fixture').hexdigest()
            rows.append(row)
        cases.append(dict(id=case_id, sourceCaseId=case_id, sliceCount=depth, dimensions=[512, 512, depth],
                          spacing=[1, 1, 2], tumorVolumeMl=voxels * .002, defaultSlice=2, slices=rows))
    return dict(version='capp-lits-v1', localOnly=True, caseCount=3, windowHu=[-150, 250], cases=cases)


class CappServerTests(unittest.TestCase):
    def test_complete_schema_and_rejections(self):
        original = manifest()
        self.assertEqual(len(serve.validate_capp_manifest(original)), 544)
        mutations = [lambda m: m.update(privatePath='private'),
                     lambda m: m['cases'][0].update(sourceCaseId='case_001'),
                     lambda m: m['cases'][0].update(defaultSlice=0),
                     lambda m: m['cases'][0].update(tumorVolumeMl=99),
                     lambda m: m['cases'][0]['slices'][0].update(ct='../source/raw.nii.gz'),
                     lambda m: m['cases'][0]['slices'][0].update(gtPixels=True),
                     lambda m: m['cases'][0]['slices'].pop()]
        for mutation in mutations:
            changed = copy.deepcopy(original); mutation(changed)
            with self.assertRaises(ValueError):
                serve.validate_capp_manifest(changed)

    def test_hashes_symlinks_and_allowlist(self):
        # Keep all temporary test output inside the supplied workspace.
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory).absolute()
            data = manifest()
            path = root / serve.CAPP_MANIFEST[1:]
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(data))
            for relative in serve.validate_capp_manifest(data):
                file = root / relative[1:]; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(b'fixture')
            content, hashes = serve.build_capp_snapshot(root)
            handler = object.__new__(serve.CappHandler)
            handler.directory = str(root); handler.manifest_content = content; handler.asset_hashes = hashes
            for route in ['/', '/app.js?v=1', serve.CAPP_MANIFEST, next(iter(hashes))]:
                handler.path = route; self.assertTrue(handler._allowed(), route)
            for route in ['/data/real_cases/manifest.json', '/data/capp_cases/source/labelsTr/case_000.nii.gz',
                          '/data/capp_cases/source-receipt.json', '/.env', '/.git/config',
                          '/data/capp_cases/web/../manifest.json', '/%2e%2e/app.js', '/%5capp.js']:
                handler.path = route; self.assertFalse(handler._allowed(), route)
            target = root / next(iter(hashes))[1:]
            target.write_bytes(b'tampered')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                serve.build_capp_snapshot(root)
            # The running handler also refuses changes after startup.
            rejected = []
            handler.path = next(iter(hashes)); handler._reject = lambda: rejected.append(True)
            handler._serve(); self.assertEqual(rejected, [True])
            # Unit-test file and ancestor links without requiring Windows
            # SeCreateSymbolicLinkPrivilege. The WSL run also checks real links.
            for linked in (target, target.parent):
                with patch.object(Path, 'is_symlink', lambda candidate: candidate == linked):
                    with self.assertRaisesRegex(ValueError, 'symlink'):
                        serve.safe_file(root, target.relative_to(root).as_posix())

    @unittest.skipIf(__import__('os').name == 'nt', 'Actual symlink creation requires Windows privilege; boundary unit tests run on all platforms')
    def test_actual_symlink_rejected(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory).absolute()
            target = root / 'file'; target.write_bytes(b'fixture')
            link = root / 'link'; link.symlink_to(target)
            with self.assertRaisesRegex(ValueError, 'symlink'):
                serve.safe_file(root, 'link')

    def test_missing_manifest_application_routes_only(self):
        handler = object.__new__(serve.CappHandler)
        handler.manifest_content = None; handler.asset_hashes = {}
        handler.path = serve.CAPP_MANIFEST; self.assertFalse(handler._allowed())
        handler.path = '/'; self.assertTrue(handler._allowed())


if __name__ == '__main__':
    unittest.main()
