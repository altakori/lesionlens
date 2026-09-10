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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    root = Path.cwd().resolve()
    SafeDemoHandler.allowed_data_paths = build_allowed_data_paths(root)
    handler = lambda *handler_args, **kwargs: SafeDemoHandler(*handler_args, directory=str(root), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"LesionLens serving on http://127.0.0.1:{args.port}/ (loopback only; {len(SafeDemoHandler.allowed_data_paths)} exact data assets)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
