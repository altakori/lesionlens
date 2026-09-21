"""Additive loopback server; legacy module is supplied by the parent app."""
import sys
import json
import hashlib
from pathlib import Path
from http.server import ThreadingHTTPServer

if __package__ in (None, ''):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts import serve_local as legacy
from scripts.radiomics_manifest import MANIFEST, build_snapshot, safe_file, sha256

ROOT = Path(__file__).resolve().parent.parent


def verify_source_evidence(root):
    """Require full approved-source and derived-image verification at startup.

    Lazy import keeps CT/demo serving available without scientific dependencies.
    This executes read-only verification, not preparation or a sidecar receipt.
    """
    from scripts.prepare_model_compare import build
    return build(repo=root, verify_only=True, evidence=True)


def make_handler(root):
    root = Path(root).resolve()
    try:
        old_content, old_assets = legacy.build_compare_snapshot(root)
    except (OSError, ValueError, TypeError, KeyError):
        old_content, old_assets = None, {}
    evidence_content = None
    if old_content:
        try:
            content = safe_file(root, 'data/model_compare/evidence.json').read_bytes()
            artifact = json.loads(content)
            from scripts.evidence_schema import validate
            validate(artifact, json.loads(old_content), hashlib.sha256(old_content).hexdigest())
            # Schema/manifest binding alone cannot establish candidate location.
            # Compare captured bytes to the full-mask recomputation returned by
            # the verifier, closing substitution during startup verification.
            if artifact != verify_source_evidence(root):
                raise ValueError('evidence differs from verified source snapshot')
            evidence_content = content
        except Exception:
            # Do not expose source paths or permit unverifiable candidate reasons.
            print('Candidate evidence unavailable: full-source verification required or failed.', flush=True)
    try:
        new_content, new_assets = build_snapshot(root)
    except Exception:
        new_content, new_assets = None, {}
        print('Radiomics panel unavailable: validation failed.', flush=True)

    class IntegratedHandler(legacy.CompareHandler):
        manifest_content = old_content
        asset_hashes = old_assets
        manifest_path = getattr(legacy.CompareHandler, 'manifest_path', None)

        def __init__(self, *args, **kwargs):
            kwargs['directory'] = str(root)
            super().__init__(*args, **kwargs)

        def _serve(self, head=False):
            path = self.path
            extra = {'/md-workflow.css', '/md-core.js', '/md-viewer.js', '/md-workflow.js', '/recipient.js', '/recipient.html', '/data/model_compare/evidence.json'}
            is_new = path in extra or path.startswith('/data/radiomics_web') or path.startswith('/radiomics.')
            if not is_new:
                # Shareable cohort links still use the legacy root document.
                # Only root/index queries are stripped; data allowlists stay exact.
                if path.partition('?')[0] in ('/', '/index.html') and '?' in path:
                    self.path = path.partition('?')[0]
                    try:
                        return super()._serve(head=head)
                    finally:
                        self.path = path
                return super()._serve(head=head)
            try:
                if path == '/data/model_compare/evidence.json':
                    if evidence_content is None:
                        return self._reject()
                    if safe_file(root, 'data/model_compare/evidence.json').read_bytes() != evidence_content:
                        return self._reject()
                    body, mime = evidence_content, 'application/json; charset=utf-8'
                elif path in extra:
                    body = safe_file(root, path[1:]).read_bytes()
                    mime = 'text/css; charset=utf-8' if path.endswith('.css') else 'text/html; charset=utf-8' if path.endswith('.html') else 'text/javascript; charset=utf-8'
                elif path == '/' + MANIFEST:
                    if new_content is None:
                        return self._reject()
                    body, mime = new_content, 'application/json; charset=utf-8'
                elif path in ('/radiomics.js', '/radiomics.css'):
                    body = safe_file(root, path[1:]).read_bytes()
                    mime = 'text/javascript; charset=utf-8' if path.endswith('.js') else 'text/css; charset=utf-8'
                elif path in new_assets:
                    body = safe_file(root, path[1:]).read_bytes()
                    if sha256(body) != new_assets[path]:
                        return self._reject()
                    mime = 'image/webp' if path.endswith('.webp') else 'image/png'
                else:
                    return self._reject()
            except Exception:
                return self._reject()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()  # inherited CSP/no-store/nosniff
            if not head:
                self.wfile.write(body)
    return IntegratedHandler


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 4173), make_handler(ROOT))
    print('Serving http://127.0.0.1:4173', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
