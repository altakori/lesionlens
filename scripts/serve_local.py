#!/usr/bin/env python
"""Serve LesionLens on loopback with an exact derived-asset allowlist."""
from __future__ import annotations

import argparse
import hashlib
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT_FILES = {"/", "/index.html", "/styles.css", "/app.js"}
DATA_MANIFEST = "/data/real_cases/manifest.json"
EXPECTED_IDS = ["LL-CT-001", "LL-CT-002", "LL-CT-003"]
SLICE_COUNT = 24


def build_allowed_data_paths(root: Path) -> set[str]:
    manifest_path = root / DATA_MANIFEST.lstrip("/")
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise FileNotFoundError("safe browser manifest is missing or symlinked")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    cases = manifest.get("cases")
    if manifest.get("version") != "ai0-lits-local-v1" or manifest.get("localOnly") is not True:
        raise ValueError("unexpected browser manifest boundary")
    if not isinstance(cases, list) or [item.get("id") for item in cases] != EXPECTED_IDS:
        raise ValueError("unexpected browser manifest cases")

    web_root = (root / "data" / "real_cases" / "web").resolve()
    allowed: set[str] = set()
    for case_index, item in enumerate(cases):
        case_id = EXPECTED_IDS[case_index]
        rows = item.get("slices")
        if item.get("sliceCount") != SLICE_COUNT or not isinstance(rows, list) or len(rows) != SLICE_COUNT:
            raise ValueError(f"unexpected slice count for {case_id}")
        for offset, row in enumerate(rows, start=1):
            filename = f"{offset:02d}"
            expected = {
                "ct": f"data/real_cases/web/{case_id}/ct/{filename}.webp",
                "overlay": f"data/real_cases/web/{case_id}/overlay/{filename}.png",
            }
            expected_hashes = {"ct": row.get("ctSha256"), "overlay": row.get("overlaySha256")}
            if row.get("index") != offset or not isinstance(row.get("sourceSlice"), int) or row["sourceSlice"] < 0 or row.get("width") != 512 or row.get("height") != 512 or not isinstance(row.get("tumorPixels"), int) or row["tumorPixels"] < 0:
                raise ValueError(f"unexpected browser metadata for {case_id} slice {offset}")
            for key, relative in expected.items():
                expected_hash = expected_hashes[key]
                if row.get(key) != relative or not isinstance(expected_hash, str) or len(expected_hash) != 64 or any(char not in "0123456789abcdef" for char in expected_hash):
                    raise ValueError(f"unexpected browser asset path or hash for {case_id} slice {offset}")
                candidate = root / relative
                resolved = candidate.resolve()
                ancestors = [candidate, *candidate.parents]
                if any(path.is_symlink() for path in ancestors if path != root.parent) or not resolved.is_relative_to(web_root):
                    raise ValueError(f"symlinked or escaping browser asset: {relative}")
                if not candidate.is_file() or candidate.suffix.lower() not in {".webp", ".png"}:
                    raise ValueError(f"missing or invalid browser asset: {relative}")
                if hashlib.sha256(candidate.read_bytes()).hexdigest() != expected_hash:
                    raise ValueError(f"browser asset hash mismatch: {relative}")
                allowed.add("/" + Path(relative).as_posix())
    if len(allowed) != len(EXPECTED_IDS) * SLICE_COUNT * 2:
        raise ValueError("incomplete exact browser asset allowlist")
    return allowed


class SafeDemoHandler(SimpleHTTPRequestHandler):
    allowed_data_paths: set[str] = set()

    def _allowed(self) -> bool:
        path = unquote(urlsplit(self.path).path)
        if "\\" in path or ".." in Path(path).parts:
            return False
        return path in ROOT_FILES or path == DATA_MANIFEST or path in self.allowed_data_paths

    def _reject(self) -> None:
        self.send_error(404, "Not found")

    def do_GET(self) -> None:  # noqa: N802
        if not self._allowed():
            self._reject()
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802
        if not self._allowed():
            self._reject()
            return
        super().do_HEAD()

    def list_directory(self, path: str):
        self._reject()
        return None

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        super().end_headers()


CAPP_MANIFEST = '/data/capp_cases/manifest.json'
CAPP_CASES = {'case_000': (75, 2591), 'case_001': (123, 7194), 'case_045': (74, 4539)}


def safe_file(root, relative, must_exist=True):
    root = Path(root).absolute()
    candidate = root / relative
    if Path(relative).is_absolute() or '..' in Path(relative).parts or '\\' in relative:
        raise ValueError('unsafe path')
    if any(part.is_symlink() for part in (candidate, *candidate.parents)):
        raise ValueError('symlinked path')
    if not candidate.resolve().is_relative_to(root.resolve()):
        raise ValueError('escaping path')
    if must_exist and not candidate.is_file():
        raise FileNotFoundError('missing web file')
    return candidate


def validate_capp_manifest(manifest):
    """Validate the complete public schema, rejecting extra/private metadata."""
    import math
    import re
    def require(condition):
        if not condition:
            raise ValueError('invalid capp manifest')
    def keys(value, expected):
        require(isinstance(value, dict) and set(value) == set(expected.split()))
    def integer(value):
        return type(value) is int
    keys(manifest, 'version localOnly caseCount windowHu cases')
    require(manifest['version'] == 'capp-lits-v1' and manifest['localOnly'] is True)
    require(type(manifest['caseCount']) is int and manifest['caseCount'] == 3 and manifest['windowHu'] == [-150, 250])
    cases = manifest['cases']
    require(isinstance(cases, list) and len(cases) == 3)
    assets = {}
    for item, (case_id, (depth, voxels)) in zip(cases, CAPP_CASES.items()):
        keys(item, 'id sourceCaseId sliceCount dimensions spacing tumorVolumeMl defaultSlice slices')
        require(item['id'] == case_id and item['sourceCaseId'] == case_id)
        require(integer(item['sliceCount']) and item['sliceCount'] == depth)
        require(item['dimensions'] == [512, 512, depth])
        spacing = item['spacing']
        require(isinstance(spacing, list) and len(spacing) == 3)
        require(all(type(v) in (float, int) and math.isfinite(v) and 0 < v < 100 for v in spacing))
        volume = item['tumorVolumeMl']
        require(type(volume) in (float, int) and math.isfinite(volume) and math.isclose(volume, voxels * math.prod(spacing) / 1000, rel_tol=1e-6))
        rows = item['slices']
        require(isinstance(rows, list) and len(rows) == depth)
        areas = []
        for z, row in enumerate(rows):
            keys(row, 'index canonicalSlice width height gtPixels ct overlay ctSha256 overlaySha256')
            require(integer(row['index']) and row['index'] == z + 1 and integer(row['canonicalSlice']) and row['canonicalSlice'] == z)
            require(row['width'] == 512 and row['height'] == 512)
            require(integer(row['gtPixels']) and 0 <= row['gtPixels'] <= 512 * 512)
            areas.append(row['gtPixels'])
            for key, ext in (('ct', 'webp'), ('overlay', 'png')):
                path = f'data/capp_cases/web/{case_id}/{key}/{z + 1:03d}.{ext}'
                digest = row[key + 'Sha256']
                require(row[key] == path and isinstance(digest, str) and re.fullmatch('[0-9a-f]{64}', digest) is not None)
                assets['/' + path] = digest
        require(sum(areas) == voxels and integer(item['defaultSlice']) and item['defaultSlice'] == areas.index(max(areas)))
    return assets


def build_capp_snapshot(root):
    content = safe_file(root, CAPP_MANIFEST[1:]).read_bytes()
    assets = validate_capp_manifest(json.loads(content))
    for path, digest in assets.items():
        if hashlib.sha256(safe_file(root, path[1:]).read_bytes()).hexdigest() != digest:
            raise ValueError('web asset hash mismatch')
    return content, assets


class CappHandler(SafeDemoHandler):
    """Serve a validated manifest snapshot and recheck asset bytes on every request."""
    manifest_content = None
    asset_hashes = {}
    manifest_path = CAPP_MANIFEST

    def _allowed(self):
        path = unquote(urlsplit(self.path).path)
        if '\\' in path or '..' in Path(path).parts:
            return False
        return path in ROOT_FILES or (self.manifest_content is not None and (path == self.manifest_path or path in self.asset_hashes))

    def _serve(self, head=False):
        if not self._allowed():
            self._reject()
            return
        path = unquote(urlsplit(self.path).path)
        try:
            if path == self.manifest_path:
                # Reject a newly introduced symlink, even though we serve a snapshot.
                safe_file(Path(self.directory), path[1:])
                content, mime = self.manifest_content, 'application/json; charset=utf-8'
            else:
                relative = 'index.html' if path == '/' else path[1:]
                file = safe_file(Path(self.directory), relative)
                content = file.read_bytes()
                if path in self.asset_hashes and hashlib.sha256(content).hexdigest() != self.asset_hashes[path]:
                    raise ValueError('changed web asset')
                mime = self.guess_type(str(file))
        except (OSError, ValueError):
            self._reject()
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        if not head:
            self.wfile.write(content)

    def do_GET(self):
        self._serve()

    def do_HEAD(self):
        self._serve(head=True)


try:
    from scripts.compare_manifest import MANIFEST as COMPARE_MANIFEST, validate_manifest as validate_compare_manifest
except ModuleNotFoundError:
    from compare_manifest import MANIFEST as COMPARE_MANIFEST, validate_manifest as validate_compare_manifest


def build_compare_snapshot(root):
    content = safe_file(root, COMPARE_MANIFEST[1:]).read_bytes()
    assets = validate_compare_manifest(json.loads(content))
    for path, digest in assets.items():
        if hashlib.sha256(safe_file(root, path[1:]).read_bytes()).hexdigest() != digest:
            raise ValueError('web asset hash mismatch')
    return content, assets


class CompareHandler(CappHandler):
    manifest_path = COMPARE_MANIFEST


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=4173)
    args = parser.parse_args()
    root = Path.cwd().resolve()
    try:
        CompareHandler.manifest_content, CompareHandler.asset_hashes = build_compare_snapshot(root)
    except (OSError, ValueError, TypeError, KeyError):
        # The UI remains reachable so it can explain unavailable local data.
        CompareHandler.manifest_content, CompareHandler.asset_hashes = None, {}
        print('CT assets unavailable or invalid; serving application only.', flush=True)
    handler = lambda *a, **kw: CompareHandler(*a, directory=str(root), **kw)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    print(f'LesionLens http://127.0.0.1:{args.port}/ (loopback only)', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
