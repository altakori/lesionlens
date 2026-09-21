"""Dependency-free synthetic HTTP tests; no real sockets or medical data."""
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts import serve_integrated as server
from scripts.evidence_schema import validate


class Socket:
    def __init__(self, request):
        self.input = io.BytesIO(request)
        self.output = io.BytesIO()
    def makefile(self, *args):
        return self.input
    def sendall(self, data):
        self.output.write(data)


class MdServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('index.html','md-workflow.css','md-core.js','md-viewer.js','md-workflow.js','recipient.js','recipient.html'):
            (self.root / name).write_text('synthetic static '+name)
        with patch.object(server.legacy,'build_compare_snapshot',side_effect=FileNotFoundError), patch.object(server,'build_snapshot',side_effect=FileNotFoundError), patch('builtins.print'):
            self.handler = server.make_handler(self.root)

    def request(self, path, method='GET'):
        socket = Socket(f'{method} {path} HTTP/1.0\r\n\r\n'.encode())
        with patch.object(self.handler,'log_message'):
            self.handler(socket, ('127.0.0.1',1234), None)
        head,body=socket.output.getvalue().split(b'\r\n\r\n',1)
        return int(head.split()[1]),head,body

    def test_static_and_head_without_real_assets(self):
        for path in ('/','/md-workflow.css','/md-core.js','/md-viewer.js','/md-workflow.js','/recipient.js','/recipient.html'):
            status,head,body=self.request(path)
            self.assertEqual(status,200)
            self.assertIn(b'Cache-Control: no-store',head)
            self.assertIn(b"default-src 'self'",head)
            self.assertTrue(body.startswith(b'synthetic static'))
            self.assertEqual(self.request(path,'HEAD')[::2],(200,b''))

    def test_exact_routes_traversal_missing_evidence_and_symlink(self):
        for path in ('/data/model_compare/evidence.json','/recipient.html?x=1','/md-core.js/extra','/%6dd-core.js','/data/../md-core.js','/../md-core.js','/private.nii','/.env','/data/model_compare/manifest.json'):
            self.assertEqual(self.request(path)[0],404,path)
        with patch.object(Path,'is_symlink',lambda p:p == self.root/'recipient.js'):
            self.assertEqual(self.request('/recipient.js')[0],404)


class EvidenceSchemaTests(unittest.TestCase):
    def fixture(self):
        manifest={'cases':[{'id':'fixture','models':{},'dimensions':[2,2,2],'spacing':[1,1,1]}]}
        e={'version':'md-evidence-v1','manifestSha256':'abc','rules':{'connectivity':26,'match':'intersection/min(component voxels) >= 0.1','overlapThreshold':.1,'smallMl':1.,'smallAdditionalRequires':'larger component in same model','clinicalValidation':False},'cases':{'fixture':{'models':{},'missingModels':['cappyv2','cp050','baseline'],'pairs':[],'reasons':[]}}}
        return e,manifest
    def test_binding_closed_schema_and_missing(self):
        e,m=self.fixture();validate(e,m,'abc')
        with self.assertRaises(ValueError):validate(e,m,'wrong')
        e['privatePath']='not public'
        with self.assertRaises(ValueError):validate(e,m,'abc')
    def test_nonempty_candidate_location_and_small_additional_rule(self):
        e,m=self.fixture()
        main={'id':'cappyv2:1','voxels':2,'volumeMl':.002,'voxel':[1,1,1],'slice':1,'bbox':[[1,1],[1,1],[0,1]]}
        small={'id':'cappyv2:2','voxels':1,'volumeMl':.001,'voxel':[5,5,5],'slice':5,'bbox':[[5,5],[5,5],[5,5]]}
        reference={**main,'id':'cp050:1'}
        m['cases'][0].update(dimensions=[10,10,10],models={'cappyv2':{'componentCount':2,'volumeMl':.003,'componentVolumesMl':[.002,.001]},'cp050':{'componentCount':1,'volumeMl':.002,'componentVolumesMl':[.002]}})
        c=e['cases']['fixture']
        c.update(models={'cappyv2':{'componentCount':2,'maxVolumeMl':.002,'totalVolumeMl':.003,'candidates':[main,small]},'cp050':{'componentCount':1,'maxVolumeMl':.002,'totalVolumeMl':.002,'candidates':[reference]}},missingModels=['baseline'],pairs=[{'models':['cappyv2','cp050'],'matches':[['cappyv2:1','cp050:1']]}],reasons=[{'kind':'unmatched','model':'cappyv2','otherModel':'cp050','candidateId':'cappyv2:2','voxel':[5,5,5],'slice':5,'smallAdditional':True}])
        validate(e,m,'abc')
        c['reasons'][0]['smallAdditional']=False
        with self.assertRaises(ValueError):validate(e,m,'abc')
        c['reasons'][0]['smallAdditional']=True
        small['voxel']=[11,5,5]
        with self.assertRaises(ValueError):validate(e,m,'abc')

    def test_no_invented_reasons(self):
        e,m=self.fixture();e['cases']['fixture']['reasons']=[{'kind':'unmatched'}]
        with self.assertRaises(ValueError):validate(e,m,'abc')

if __name__ == '__main__':
    unittest.main()
