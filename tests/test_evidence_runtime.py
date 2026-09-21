"""Runtime provenance regressions with synthetic metadata/in-memory HTTP only."""
import copy
import hashlib
import json
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from scripts import serve_integrated as server
from scripts.evidence_schema import validate
from test_md_server import Socket


def fixture():
    stats = {'componentCount': 1, 'volumeMl': .001, 'componentVolumesMl': [.001]}
    manifest = {'cases': [{'id': 'fixture', 'dimensions': [8,8,8], 'spacing': [1,1,1],
                           'models': {'cappyv2': stats, 'cp050': stats}}]}
    raw = json.dumps(manifest).encode()
    models, reasons = {}, []
    for model, other, pos in [('cappyv2','cp050',1), ('cp050','cappyv2',6)]:
        candidate = {'id': model+':1', 'voxels': 1, 'volumeMl': .001, 'voxel': [pos,pos,pos],
                     'slice': pos, 'bbox': [[pos,pos]] * 3}
        models[model] = {'componentCount': 1, 'maxVolumeMl': .001, 'totalVolumeMl': .001, 'candidates': [candidate]}
        reasons.append({'kind': 'unmatched', 'model': model, 'otherModel': other, 'candidateId': model+':1',
                        'voxel': [pos,pos,pos], 'slice': pos, 'smallAdditional': False})
    evidence = {'version': 'md-evidence-v1', 'manifestSha256': hashlib.sha256(raw).hexdigest(),
                'rules': {'connectivity':26, 'match':'intersection/min(component voxels) >= 0.1',
                          'overlapThreshold':.1, 'smallMl':1., 'smallAdditionalRequires':'larger component in same model',
                          'clinicalValidation':False},
                'cases': {'fixture': {'models':models, 'missingModels':['baseline'],
                                      'pairs':[{'models':['cappyv2','cp050'], 'matches':[]}], 'reasons':reasons}}}
    return manifest, raw, evidence


class RuntimeEvidenceTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.path = self.root / 'data/model_compare/evidence.json'
        self.path.parent.mkdir(parents=True)
        (self.root / 'index.html').write_text('synthetic app')
        self.manifest, self.raw, self.verified = fixture()
        self.write(self.verified)

    def write(self, artifact):
        self.path.write_text(json.dumps(artifact))

    def handler(self, verifier):
        with patch.object(server.legacy, 'build_compare_snapshot', return_value=(self.raw, {})), \
                patch.object(server, 'build_snapshot', side_effect=FileNotFoundError), \
                patch.object(server, 'verify_source_evidence', verifier), patch('builtins.print'):
            return server.make_handler(self.root)

    def request(self, handler, path='/data/model_compare/evidence.json', method='GET'):
        socket = Socket(f'{method} {path} HTTP/1.0\r\n\r\n'.encode())
        with patch.object(handler, 'log_message'):
            handler(socket, ('127.0.0.1', 1234), None)
        headers, body = socket.output.getvalue().split(b'\r\n\r\n', 1)
        return int(headers.split()[1]), body

    def test_source_verified_snapshot_served_without_removing_reasons(self):
        verifier = Mock(return_value=copy.deepcopy(self.verified))
        handler = self.handler(verifier)
        verifier.assert_called_once_with(self.root.resolve())
        status, raw = self.request(handler)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), self.verified)
        self.assertEqual(len(json.loads(raw)['cases']['fixture']['reasons']), 2)
        self.assertEqual(self.request(handler, method='HEAD'), (200, b''))

    def test_in_bounds_location_forgery_passes_schema_but_is_not_served(self):
        forged = copy.deepcopy(self.verified)
        case = forged['cases']['fixture']
        case['models']['cappyv2']['candidates'][0].update(voxel=[2,2,2], slice=2, bbox=[[2,2]]*3)
        case['reasons'][0].update(voxel=[2,2,2], slice=2)
        validate(forged, self.manifest, hashlib.sha256(self.raw).hexdigest())
        self.write(forged)
        verifier = Mock(return_value=copy.deepcopy(self.verified))
        handler = self.handler(verifier)
        verifier.assert_called_once()
        self.assertEqual(self.request(handler)[0], 404)
        self.assertEqual(self.request(handler, '/')[0], 200)

    def test_self_consistent_forged_matches_also_rejected(self):
        forged = copy.deepcopy(self.verified)
        forged['cases']['fixture']['pairs'][0]['matches'] = [['cappyv2:1','cp050:1']]
        forged['cases']['fixture']['reasons'] = []
        validate(forged, self.manifest, hashlib.sha256(self.raw).hexdigest())
        self.write(forged)
        self.assertEqual(self.request(self.handler(Mock(return_value=self.verified)))[0], 404)

    def test_missing_dependencies_masks_or_failed_binding_fail_closed(self):
        for failure in (ImportError('scientific dependency'), FileNotFoundError('source'), ValueError('source hash'), ValueError('overlay binding')):
            with self.subTest(failure=type(failure).__name__):
                handler = self.handler(Mock(side_effect=failure))
                self.assertEqual(self.request(handler)[0], 404)
                self.assertEqual(self.request(handler, '/')[0], 200)

    def test_post_start_edit_and_symlink_never_served(self):
        handler = self.handler(Mock(return_value=copy.deepcopy(self.verified)))
        self.path.write_text('{}')
        self.assertEqual(self.request(handler)[0], 404)
        self.write(self.verified)
        with patch.object(Path, 'is_symlink', lambda p: p == self.path):
            self.assertEqual(self.request(handler)[0], 404)

    def test_startup_substitution_cannot_replace_captured_artifact(self):
        def swap():
            self.path.write_text('{}')
            return copy.deepcopy(self.verified)
        handler = self.handler(Mock(side_effect=lambda root: swap()))
        self.assertEqual(self.request(handler)[0], 404)

    def test_source_verifier_requires_existing_read_only_full_pipeline(self):
        module = types.ModuleType('scripts.prepare_model_compare')
        module.build = Mock(return_value=self.verified)
        with patch.dict('sys.modules', {'scripts.prepare_model_compare':module}):
            self.assertEqual(server.verify_source_evidence(self.root), self.verified)
        module.build.assert_called_once_with(repo=self.root, verify_only=True, evidence=True)


if __name__ == '__main__':
    unittest.main()
