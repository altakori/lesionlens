"""Build only approved, source-bound CT and model comparisons. No downloads."""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image
from scipy import ndimage

try:
    from scripts import prepare_capp_cases as original
    from scripts.compare_manifest import CASES, MODELS, VERSION, validate_manifest
    from scripts.serve_local import safe_file
except ModuleNotFoundError:
    import prepare_capp_cases as original
    from compare_manifest import CASES, MODELS, VERSION, validate_manifest
    from serve_local import safe_file


def validate_source(obj, entry, is_ct=False):
    affine = obj.affine
    if (list(obj.shape) != entry['shape'] or not np.isfinite(affine).all()
            or not np.array_equal(affine, np.asarray(entry['affine']))
            or abs(np.linalg.det(affine[:3, :3])) <= 0
            or not np.allclose(obj.header.get_zooms()[:3], entry['spacing'], atol=1e-6, rtol=0)
            or not np.allclose(nib.affines.voxel_sizes(affine), entry['spacing'], atol=1e-6, rtol=0)
            or ''.join(nib.aff2axcodes(affine)) != entry['orientation']):
        raise ValueError('source geometry mismatch')
    values = np.asanyarray(obj.dataobj)
    if not np.isfinite(values).all():
        raise ValueError('nonfinite source')
    if not is_ct and (not np.isin(values, (0, 1, 2)).all() or np.count_nonzero(values == 2) != entry['voxels2']):
        raise ValueError('source label values or voxel count mismatch')


def load_source(root, entry):
    path = safe_file(root, entry['local'])
    if original.sha256(path) != entry['sha256']:
        raise ValueError('source hash mismatch')
    obj = nib.load(str(path))
    validate_source(obj, entry, entry['kind'] == 'ct')
    return obj


def canonical_arrays(objects):
    reference = objects['ct']
    for obj in objects.values():
        if obj.shape != reference.shape or not np.array_equal(obj.affine, reference.affine):
            raise ValueError('exact CT/GT/model affine or shape mismatch')
    canonical = {kind: nib.as_closest_canonical(obj) for kind, obj in objects.items()}
    ref = canonical['ct']
    spacing = nib.affines.voxel_sizes(ref.affine)
    voxel_ml = abs(float(np.linalg.det(ref.affine[:3, :3]))) / 1000
    if not np.isclose(np.prod(spacing) / 1000, voxel_ml, rtol=1e-6):
        raise ValueError('unsupported sheared geometry')
    arrays = {}
    for kind, obj in canonical.items():
        if not np.array_equal(obj.affine, ref.affine) or obj.shape != ref.shape:
            raise ValueError('canonical geometry mismatch')
        data = np.asanyarray(obj.dataobj)
        if not np.isfinite(data).all() or (kind != 'ct' and not np.isin(data, (0, 1, 2)).all()):
            raise ValueError('nonfinite CT or invalid label values')
        arrays[kind] = data if kind == 'ct' else data == 2
    return arrays, spacing.tolist(), voxel_ml


def mask_stats(mask, voxel_ml):
    labeled, count = ndimage.label(mask, structure=np.ones((3, 3, 3), dtype=np.uint8))
    sizes = np.bincount(labeled.ravel(), minlength=count + 1)[1:]
    areas = np.count_nonzero(mask, axis=(0, 1))
    positive = np.flatnonzero(areas) + 1
    voxels = int(np.count_nonzero(mask))
    return {'voxels': voxels, 'volumeMl': voxels * voxel_ml,
            'componentVolumesMl': sorted((sizes * voxel_ml).tolist(), reverse=True),
            'componentCount': int(count), 'positiveSliceCount': len(positive),
            'sliceSpan': [int(positive[0]), int(positive[-1])] if len(positive) else None}


def disagreement(masks):
    union = int(np.count_nonzero(np.logical_or.reduce(masks)))
    intersection = int(np.count_nonzero(np.logical_and.reduce(masks)))
    return {'intersectionVoxels': intersection, 'unionVoxels': union,
            'score': 1 - intersection / union if union else 0}


def encode_plane(array, kind):
    # All sources share this RAS -> radiological display transform.
    plane = np.fliplr(np.rot90(array))
    if kind == 'ct':
        pixels = ((np.clip(plane, -150, 250) + 150) * (255 / 400)).astype(np.uint8)
    else:
        pixels = np.zeros((*plane.shape, 4), dtype=np.uint8)
        colors = {'gt': (255, 82, 151, 160), 'baseline': (255, 191, 71, 160),
                  'cappyv2': (64, 208, 222, 160), 'cp050': (170, 139, 250, 160)}
        pixels[plane] = colors[kind]
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format='WEBP' if kind == 'ct' else 'PNG',
                                **({'lossless': True, 'method': 4} if kind == 'ct' else {}))
    return buffer.getvalue()


def build(repo=Path('.'), verify_only=False):
    repo = repo.absolute()
    root = repo / 'data/model_compare'
    entries = json.loads(safe_file(repo, 'scripts/compare_sources.json').read_text(encoding='utf-8'))
    entries = {(entry['id'], entry['kind']): entry for entry in entries}
    cases = []
    for case_id in CASES:
        objects = {}
        if case_id in original.EXPECTED:
            paths = original.validate_source_identity(repo / 'data/capp_cases', case_id)
            objects['ct'], objects['gt'] = (nib.load(str(path)) for path in paths)
            original.canonical_pair(objects['ct'], objects['gt'], case_id)
        else:
            for kind in ('ct', 'gt'):
                objects[kind] = load_source(root, entries[case_id, kind])
        if case_id != 'case_045':
            for kind in MODELS:
                objects[kind] = load_source(root, entries[case_id, kind])
        arrays, spacing, voxel_ml = canonical_arrays(objects)
        stats = {kind: mask_stats(mask, voxel_ml) for kind, mask in arrays.items() if kind != 'ct'}
        areas = {kind: np.count_nonzero(mask, axis=(0, 1)).tolist() for kind, mask in arrays.items() if kind != 'ct'}
        depth = arrays['ct'].shape[2]
        rows = []
        for z in range(depth):
            row = {'index': z + 1, 'canonicalSlice': z, 'width': 512, 'height': 512,
                   'gtPixels': areas['gt'][z], 'pixels': {kind: values[z] for kind, values in areas.items()}, 'overlays': {}}
            for kind, array in arrays.items():
                content = encode_plane(array[:, :, z], kind)
                relative = f'data/model_compare/web/{case_id}/{kind}/{z + 1:03d}.{"webp" if kind == "ct" else "png"}'
                path = safe_file(repo, relative, must_exist=verify_only)
                digest = hashlib.sha256(content).hexdigest()
                if verify_only:
                    if original.sha256(path) != digest:
                        raise ValueError(f'source binding mismatch: {case_id}/{kind}/{z + 1}')
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(content)
                if kind == 'ct':
                    row['ct'], row['ctSha256'] = relative, digest
                else:
                    row['overlays'][kind] = {'path': relative, 'sha256': digest}
            rows.append(row)
        cases.append({'id': case_id, 'sourceCaseId': case_id, 'sliceCount': depth,
                      'dimensions': list(arrays['ct'].shape), 'spacing': spacing,
                      'tumorVolumeMl': stats['gt']['volumeMl'], 'defaultSlice': int(np.argmax(areas['gt'])),
                      'gt': stats['gt'], 'models': {kind: stats[kind] for kind in MODELS if kind in stats},
                      'disagreement': disagreement([arrays[k] for k in MODELS]) if case_id != 'case_045' else None,
                      'slices': rows})
    manifest = {'version': VERSION, 'localOnly': True, 'caseCount': 5, 'windowHu': [-150, 250], 'cases': cases}
    validate_manifest(manifest)
    target = safe_file(repo, 'data/model_compare/manifest.json', must_exist=verify_only)
    if verify_only:
        if json.loads(target.read_text(encoding='utf-8')) != manifest:
            raise ValueError('manifest differs from approved source-derived metadata')
    else:
        pending = safe_file(repo, 'data/model_compare/manifest.pending', must_exist=False)
        pending.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        pending.replace(target)
    print(json.dumps({'version': VERSION, 'cases': 5, 'slices': sum(c['sliceCount'] for c in cases), 'sourceBound': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-only', action='store_true')
    build(verify_only=parser.parse_args().verify_only)
