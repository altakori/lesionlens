#!/usr/bin/env python3
"""Prepare the three approved matched LiTS pairs; never downloads source data."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image

try:
    from scripts.serve_local import validate_capp_manifest, safe_file
except ModuleNotFoundError:
    from serve_local import validate_capp_manifest, safe_file

VERSION = 'capp-lits-v1'
EXPECTED = {
    'case_000': ('5b41a5c4065094a3a8af45c01d49852d6ae5a215cc7807c318aef2744eb125f1', '0c321bbb90c0cfa15b3d552ee798b1ab50e86232242899f339da1c763a04e684', 75, 2591, 'LAS', (1, 2), (1, 1)),
    'case_001': ('df5adbd92a7decb53f715b7ff053b0591b2533ea99f7464ff38904ee2b1c2f2c', 'a00de799abf52381f861b1dac6fbb264a97cc32ab43fc6ba86e1bc1be994a92d', 123, 7194, 'LAS', (1, 2), (1, 1)),
    'case_045': ('1f63e67495bcf5520703500dcbe2cdcd4efc2885e974e5d6120fe6e22e157ff6', '6728d52cb909eea9ba2552daf7abfc911bf4cc1340c1f9d9a50bbc47aed8a422', 74, 4539, 'RAS', (0, 0), (2, 2)),
}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_source_identity(root, case_id):
    paths = (root / 'source' / 'imagesTr' / f'{case_id}_0000.nii.gz',
             root / 'source' / 'labelsTr' / f'{case_id}.nii.gz')
    for path, expected in zip(paths, EXPECTED[case_id][:2]):
        safe_file(root, path.relative_to(root).as_posix())
        if sha256(path) != expected:
            raise ValueError(f'source hash mismatch: {case_id}')
    return paths


def validate_geometry(image, label, case_id):
    expected = EXPECTED[case_id]
    if image.shape != (512, 512, expected[2]) or label.shape != image.shape:
        raise ValueError(f'shape mismatch: {case_id}')
    if not np.isfinite(image.affine).all() or not np.allclose(image.affine, label.affine, atol=1e-5, rtol=0):
        raise ValueError(f'effective affine mismatch: {case_id}')
    if abs(np.linalg.det(image.affine[:3, :3])) <= 0:
        raise ValueError(f'singular affine: {case_id}')
    for obj in (image, label):
        if ''.join(nib.aff2axcodes(obj.affine)) != expected[4]:
            raise ValueError(f'orientation mismatch: {case_id}')
    for kind, codes in zip(('qform', 'sform'), expected[5:]):
        if tuple(int(getattr(obj, f'get_{kind}')(coded=True)[1]) for obj in (image, label)) != codes:
            raise ValueError(f'{kind} codes mismatch: {case_id}')
    # Effective affine is authoritative; qform codes may legitimately differ.
    if not np.allclose(image.header.get_zooms()[:3], label.header.get_zooms()[:3], atol=1e-6, rtol=0):
        raise ValueError(f'spacing mismatch: {case_id}')


def canonical_pair(image, label, case_id):
    validate_geometry(image, label, case_id)
    image, label = nib.as_closest_canonical(image), nib.as_closest_canonical(label)
    if not np.allclose(image.affine, label.affine, atol=1e-5, rtol=0):
        raise ValueError('canonical affine mismatch')
    ct, gt = np.asanyarray(image.dataobj), np.asanyarray(label.dataobj)
    if not np.isfinite(ct).all() or not np.isfinite(gt).all() or not np.isin(gt, (0, 1, 2)).all():
        raise ValueError('nonfinite CT or invalid label values')
    if np.count_nonzero(gt == 2) != EXPECTED[case_id][3]:
        raise ValueError('GT voxel count mismatch')
    return image, ct, gt


def encode_slice(ct, gt):
    # RAS axial data -> anterior at top, patient right at display left.
    pixels = np.fliplr(np.rot90(((np.clip(ct, -150, 250) + 150) * (255 / 400)).astype(np.uint8)))
    mask = np.fliplr(np.rot90(gt == 2))
    rgba = np.zeros((*mask.shape, 4), dtype=np.uint8)
    rgba[mask] = (255, 82, 151, 160)
    output = []
    for array, fmt in ((pixels, 'WEBP'), (rgba, 'PNG')):
        buffer = io.BytesIO()
        Image.fromarray(array).save(buffer, format=fmt, **({'lossless': True, 'method': 4} if fmt == 'WEBP' else {}))
        output.append(buffer.getvalue())
    return output


def build(root, verify_only=False):
    root = root.absolute()
    repo = root.parent.parent
    if root != repo / 'data' / 'capp_cases':
        raise ValueError('root must end with data/capp_cases')
    cases = []
    for case_id in EXPECTED:
        paths = validate_source_identity(root, case_id)
        obj, ct, gt = canonical_pair(*(nib.load(str(p)) for p in paths), case_id)
        spacing = nib.affines.voxel_sizes(obj.affine).tolist()
        voxel_ml = abs(float(np.linalg.det(obj.affine[:3, :3]))) / 1000
        # Reject shear: spacing product must describe the same voxel volume.
        if not np.isclose(np.prod(spacing) / 1000, voxel_ml, rtol=1e-6):
            raise ValueError('unsupported sheared geometry')
        areas = np.count_nonzero(gt == 2, axis=(0, 1)).tolist()
        rows = []
        for z in range(ct.shape[2]):
            row = {'index': z + 1, 'canonicalSlice': z, 'width': ct.shape[0], 'height': ct.shape[1], 'gtPixels': areas[z]}
            for key, ext, content in zip(('ct', 'overlay'), ('webp', 'png'), encode_slice(ct[:, :, z], gt[:, :, z])):
                relative = f'data/capp_cases/web/{case_id}/{key}/{z + 1:03d}.{ext}'
                target = repo / relative
                # Check every ancestor before creating or writing any output.
                safe_file(repo, relative, must_exist=False)
                if verify_only:
                    if sha256(target) != hashlib.sha256(content).hexdigest():
                        raise ValueError(f'source binding mismatch: {case_id} slice {z + 1}')
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(content)
                row[key], row[key + 'Sha256'] = relative, hashlib.sha256(content).hexdigest()
            rows.append(row)
        cases.append({'id': case_id, 'sourceCaseId': case_id, 'sliceCount': ct.shape[2],
                      'dimensions': list(ct.shape), 'spacing': spacing,
                      'tumorVolumeMl': sum(areas) * voxel_ml, 'defaultSlice': int(np.argmax(areas)), 'slices': rows})
    manifest = {'version': VERSION, 'localOnly': True, 'caseCount': len(cases), 'windowHu': [-150, 250], 'cases': cases}
    validate_capp_manifest(manifest)
    path = safe_file(repo, 'data/capp_cases/manifest.json', must_exist=verify_only)
    if verify_only:
        if json.loads(path.read_text(encoding='utf-8')) != manifest:
            raise ValueError('manifest differs from approved source-derived metadata')
    else:
        temporary = safe_file(repo, 'data/capp_cases/manifest.pending', must_exist=False)
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(path)
    print(json.dumps({'version': VERSION, 'cases': len(cases), 'slices': sum(c['sliceCount'] for c in cases), 'sourceBound': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path('data/capp_cases'))
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    build(args.root, args.verify_only)
