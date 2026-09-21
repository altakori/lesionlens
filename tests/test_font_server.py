"""Font HTTP boundary tests using only synthetic bytes and in-memory sockets."""
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import serve_local as serve


FONT_ROUTE = '/fonts/PretendardVariable.woff2'
FONT_BYTES = b'wOF2\x00synthetic-font-fixture\xff'
CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"


class MemorySocket:
    def __init__(self, request):
        self.request = io.BytesIO(request)
        self.response = io.BytesIO()

    def makefile(self, mode, buffering):
        return self.request

    def sendall(self, content):
        self.response.write(content)


class FontServerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).absolute()
        self.font = self.root / FONT_ROUTE[1:]
        self.font.parent.mkdir()
        self.font.write_bytes(FONT_BYTES)

    def request(self, route=FONT_ROUTE, method='GET'):
        connection = MemorySocket(f'{method} {route} HTTP/1.0\r\n\r\n'.encode('ascii'))
        # Exercise the actual application handler with unavailable CT data.
        with patch.object(serve.CompareHandler, 'manifest_content', None), \
                patch.object(serve.CompareHandler, 'asset_hashes', {}), \
                patch.object(serve.CompareHandler, 'log_message'):
            serve.CompareHandler(connection, ('127.0.0.1', 12345), None,
                                 directory=str(self.root))
        headers, body = connection.response.getvalue().split(b'\r\n\r\n', 1)
        lines = headers.decode('iso-8859-1').split('\r\n')
        status = int(lines[0].split()[1])
        headers = dict(line.split(': ', 1) for line in lines[1:])
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(headers['Content-Security-Policy'], CSP)
        return status, headers, body

    def assert_rejected(self, route=FONT_ROUTE):
        for method in ('GET', 'HEAD'):
            with self.subTest(route=route, method=method):
                status, _, body = self.request(route, method)
                self.assertEqual(status, 404)
                self.assertNotIn(FONT_BYTES, body)
                if method == 'HEAD':
                    self.assertEqual(body, b'')

    def test_font_get_and_head_without_manifest(self):
        # MIME must be correct even if the host MIME database has no WOFF2 entry.
        with patch.object(serve.CompareHandler, 'guess_type', return_value='application/octet-stream'):
            for route in (FONT_ROUTE, FONT_ROUTE + '?v=1'):
                for method in ('GET', 'HEAD'):
                    with self.subTest(route=route, method=method):
                        status, headers, body = self.request(route, method)
                        self.assertEqual(status, 200)
                        self.assertEqual(headers['Content-Type'], 'font/woff2')
                        self.assertEqual(headers['Content-Length'], str(len(FONT_BYTES)))
                        self.assertEqual(body, FONT_BYTES if method == 'GET' else b'')

    def test_unknown_files_and_directory_rejected(self):
        for relative in ('fonts/Other.woff2', 'fonts/PretendardVariable.ttf',
                         'fonts/PretendardVariable.woff2.css', 'other.woff2',
                         'fonts/pretendardvariable.woff2'):
            (self.root / relative).write_bytes(FONT_BYTES)
            self.assert_rejected('/' + relative)
        for route in ('/fonts', '/fonts/', FONT_ROUTE + '/', '/unknown',
                      '/fonts//PretendardVariable.woff2'):
            self.assert_rejected(route)

    def test_traversal_and_backslash_rejected(self):
        for route in ('/fonts/../fonts/PretendardVariable.woff2',
                      '/fonts/%2e%2e/fonts/PretendardVariable.woff2',
                      '/fonts/%252e%252e/fonts/PretendardVariable.woff2',
                      '/fonts/./PretendardVariable.woff2',
                      '/fonts%5cPretendardVariable.woff2',
                      '/%2e%2e/fonts/PretendardVariable.woff2'):
            self.assert_rejected(route)

    def test_missing_font_and_directory_in_place_of_font_rejected(self):
        self.font.unlink()
        self.assert_rejected()
        self.font.mkdir()
        self.assert_rejected()

    def test_file_and_parent_symlink_checks(self):
        for linked in (self.font, self.font.parent):
            with self.subTest(linked=linked), \
                    patch.object(Path, 'is_symlink', lambda candidate: candidate == linked):
                self.assert_rejected()

    @unittest.skipIf(os.name == 'nt', 'Actual symlinks require Windows privilege; mocked checks run everywhere')
    def test_actual_file_and_directory_symlinks_rejected(self):
        target = self.root / 'target.woff2'
        target.write_bytes(FONT_BYTES)
        self.font.unlink()
        self.font.symlink_to(target)
        self.assert_rejected()
        self.font.unlink()
        self.font.parent.rmdir()
        target_directory = self.root / 'target_fonts'
        target_directory.mkdir()
        (target_directory / self.font.name).write_bytes(FONT_BYTES)
        self.font.parent.symlink_to(target_directory, target_is_directory=True)
        self.assert_rejected()

    def test_main_binds_loopback(self):
        with patch('sys.argv', ['serve_local.py']), \
                patch.object(serve, 'build_compare_snapshot', side_effect=FileNotFoundError), \
                patch.object(serve, 'ThreadingHTTPServer') as server, \
                patch.object(serve.CompareHandler, 'manifest_content', None), \
                patch.object(serve.CompareHandler, 'asset_hashes', {}), \
                patch('builtins.print'):
            serve.main()
        self.assertEqual(server.call_args.args[0], ('127.0.0.1', 4173))
        server.return_value.serve_forever.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
