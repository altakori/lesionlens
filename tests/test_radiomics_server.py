import http.client
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch
from test_radiomics_manifest import WORKSPACE, write_fixture
from symlink_support import require_symlinks


class StubLegacy(SimpleHTTPRequestHandler):
    manifest_path = '/legacy-manifest.json'
    def log_message(self, *args): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'")
        super().end_headers()
    def _reject(self): self.send_error(404, 'Unavailable')
    def _serve(self, head=False):
        if self.path != '/': return self._reject()
        self.send_response(200); self.send_header('Content-Length', '6'); self.end_headers()
        if not head: self.wfile.write(b'legacy')
    def do_GET(self): self._serve()
    def do_HEAD(self): self._serve(True)


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=WORKSPACE); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.manifest = write_fixture(self.root)
        (self.root / 'radiomics.js').write_text('synthetic'); (self.root / 'radiomics.css').write_text('synthetic')
        stub = types.ModuleType('scripts.serve_local'); stub.CompareHandler = StubLegacy
        stub.build_compare_snapshot = lambda root: (b'legacy snapshot', {})
        self.patch = patch.dict(sys.modules, {'scripts.serve_local': stub}); self.patch.start(); self.addCleanup(self.patch.stop)
        import scripts
        self.attr_patch = patch.object(scripts, 'serve_local', stub, create=True); self.attr_patch.start(); self.addCleanup(self.attr_patch.stop)
        sys.modules.pop('scripts.serve_integrated', None)
        self.module = importlib.import_module('scripts.serve_integrated')

    def start(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), self.module.make_handler(self.root))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join()))
        self.port = server.server_port

    def request(self, path, method='GET'):
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        conn.request(method, path); response = conn.getresponse(); body = response.read(); headers = dict(response.getheaders()); status = response.status; conn.close()
        return status, body, headers

    def test_http_allowlist_and_corruption(self):
        self.start()
        for path in ('/', '/radiomics.js', '/radiomics.css', '/data/radiomics_web/manifest.json', '/' + self.manifest['cases'][0]['slices'][0]['ct']):
            status, body, headers = self.request(path); self.assertEqual(status, 200)
            self.assertEqual(headers['Cache-Control'], 'no-store'); self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
            status2, body2, headers2 = self.request(path, 'HEAD')
            self.assertEqual((status2, body2, headers2['Content-Length']), (200, b'', str(len(body))))
        for path in ('/data/radiomics_web/', '/data/radiomics_web/../local.json', '/data/radiomics_web/%2e%2e/local.json', '/radiomics.js?x=1', '/data/radiomics_web/manifest.json/raw', '/raw.nii', '/%64ata/radiomics_web/manifest.json'):
            self.assertEqual(self.request(path)[0], 404)
        path = self.root / self.manifest['cases'][0]['slices'][0]['ct']; path.write_bytes(b'corrupt')
        for method in ('GET', 'HEAD'):
            self.assertEqual(self.request('/' + self.manifest['cases'][0]['slices'][0]['ct'], method)[0], 404)
        (self.root / 'data/radiomics_web/manifest.json').write_text('{}')
        self.assertEqual(self.request('/data/radiomics_web/manifest.json')[0], 200)  # frozen validated snapshot
        self.assertEqual(self.request('/')[1], b'legacy')

    def test_real_symlink_assets_and_static(self):
        require_symlinks(self, self.root)
        self.start()
        path = self.root / self.manifest['cases'][0]['slices'][0]['ct']
        path.unlink(); path.symlink_to(self.root / 'radiomics.js')
        self.assertEqual(self.request('/' + self.manifest['cases'][0]['slices'][0]['ct'])[0], 404)
        (self.root / 'radiomics.js').unlink(); (self.root / 'radiomics.js').symlink_to(self.root / 'radiomics.css')
        self.assertEqual(self.request('/radiomics.js')[0], 404)

    def test_mock_symlink_assets_static_and_ancestors(self):
        self.start()
        asset = self.manifest['cases'][0]['slices'][0]['ct']
        real_is_symlink = Path.is_symlink
        for blocked, url in ((self.root / asset, '/' + asset),
                             ((self.root / asset).parent, '/' + asset),
                             (self.root / 'data', '/' + asset),
                             (self.root / 'radiomics.js', '/radiomics.js')):
            with self.subTest(blocked=blocked.name):
                def is_symlink(path):
                    return path == blocked or real_is_symlink(path)
                with patch.object(Path, 'is_symlink', is_symlink):
                    for method in ('GET', 'HEAD'):
                        self.assertEqual(self.request(url, method)[0], 404)
        self.assertEqual(self.request('/')[1], b'legacy')

    def test_invalid_new_snapshot_does_not_break_legacy(self):
        (self.root / 'data/radiomics_web/manifest.json').write_text('{"private":"no"}')
        self.start()
        self.assertEqual(self.request('/')[1], b'legacy')
        self.assertEqual(self.request('/data/radiomics_web/manifest.json')[0], 404)
        self.assertEqual(self.request('/' + self.manifest['cases'][0]['slices'][0]['ct'])[0], 404)



class DispatchTests(ServerTests):
    """Additional socket-free handler checks, not replacements for HTTP tests."""
    # Replay inherited assertions without sockets; ServerTests still uses real HTTP.
    def start(self):
        self.handler = self.module.make_handler(self.root)

    def request(self, path, method='GET'):
        import io
        handler = object.__new__(self.handler)
        handler.path = path
        handler.wfile = io.BytesIO()
        headers = {}
        status = []
        handler.send_response = lambda code: status.append(code)
        handler.send_header = lambda k, v: headers.update({k: v})
        handler.end_headers = lambda: headers.update({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
        handler._reject = lambda: status.append(404)
        handler._serve(head=method == 'HEAD')
        self.assertEqual(handler.path, path)
        return status[0], handler.wfile.getvalue(), headers

    def test_root_query_dispatch(self):
        self.start()
        for suffix in ('?cohort=legacy', '?other=1&cohort=legacy'):
            self.assertEqual(self.request('/' + suffix)[1], b'legacy')


if __name__ == '__main__': unittest.main()
