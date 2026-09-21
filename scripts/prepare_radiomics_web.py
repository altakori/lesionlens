"""Sequential, local-only CT/GT exporter. Install imaging dependencies in parent environment."""
import argparse
import io
import json
import math
import os
import sys
from pathlib import Path

if __package__:
    from .radiomics_manifest import (MANIFEST, build_snapshot, case_id, digest, keys,
                                    parse_json, require, safe_file, sha256,
                                    validate_groups, validate_manifest, validate_metrics)
else:
    from radiomics_manifest import (MANIFEST, build_snapshot, case_id, digest, keys,
                                   parse_json, require, safe_file, sha256,
                                   validate_groups, validate_manifest, validate_metrics)


def validate_config(config):
    keys(config, {'version', 'cases'})
    require(type(config['version']) is int and config['version'] == 1)
    require(type(config['cases']) is list and 1 <= len(config['cases']) <= 100)
    seen = set()
    for c in config['cases']:
        keys(c, {'id', 'image', 'mask', 'imageSha256', 'maskSha256', 'metrics'})
        require(case_id(c['id']) and c['id'] not in seen)
        seen.add(c['id'])
        for k in ('image', 'mask'):
            require(type(c[k]) is str and bool(c[k]) and digest(c[k + 'Sha256']))
        validate_metrics(c['metrics'])
    validate_groups(config['cases'])
    return config


def source_hash(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def load_case(c, base):
    import numpy as np
    import nibabel as nib
    paths = [base / c[k] for k in ('image', 'mask')]
    for k, p in zip(('image', 'mask'), paths):
        require(source_hash(p) == c[k + 'Sha256'])
    image, mask = [nib.load(str(p), mmap=False, keep_file_open=False) for p in paths]
    # CT affine lengths are millimetres; never silently interpret metres/microns.
    require(all(v.header.get_xyzt_units()[0] in ('mm', 'unknown') for v in (image, mask)))
    require(len(image.shape) == 3 and all(0 < n <= 10000 for n in image.shape))
    require(image.shape == mask.shape and np.array_equal(image.affine, mask.affine))
    a = image.affine
    require(a.shape == (4, 4) and np.isfinite(a).all() and np.array_equal(a[3], [0, 0, 0, 1]))
    require(abs(np.linalg.det(a[:3, :3])) > 0)
    # Shear has no faithful representation in the axis-aligned slice viewer.
    basis = a[:3, :3] / np.linalg.norm(a[:3, :3], axis=0)
    require(np.allclose(basis.T @ basis, np.eye(3), atol=1e-5, rtol=0))
    # Keep the CT working array at float32, with no get_fdata cache. Release
    # canonicalization's backing array before materializing the mask.
    image = nib.as_closest_canonical(image)
    canonical_affine = image.affine.copy()
    spacing = np.linalg.norm(canonical_affine[:3, :3], axis=0).tolist()
    # Own the returned storage: no memmap/view may keep a Windows source file
    # locked after load_case returns. The transient copy is float32 too.
    ct = np.array(image.get_fdata(dtype=np.float32, caching='unchanged'),
                  dtype=np.float32, copy=True, order='K')
    del image
    require(all(np.isfinite(ct[:, :, i]).all() for i in range(ct.shape[2])))
    mask = nib.as_closest_canonical(mask)
    require(np.array_equal(canonical_affine, mask.affine))
    # Validate effective source values BEFORE uint8 conversion; fractional,
    # nonfinite and out-of-range values must never round/truncate into labels.
    labels = np.empty(mask.shape, dtype=np.uint8)
    for i in range(mask.shape[2]):
        plane = np.asanyarray(mask.dataobj[:, :, i])
        require(np.isin(plane, [0, 1, 2]).all())
        labels[:, :, i] = plane
    del plane, mask
    gt = labels == 2
    del labels
    require(bool(gt.any()) == (c['metrics']['componentCount'] > 0))
    try:
        from scipy import ndimage
    except ImportError:
        raise ValueError('SciPy required for component verification') from None
    # Scientific contract: face, edge AND corner contact join a component.
    components, count = ndimage.label(gt, structure=ndimage.generate_binary_structure(3, 3))
    # Avoid the whole-volume int64 conversion that bincount would make
    # from a 32-bit label map.
    sizes = np.zeros(count + 1, dtype=np.int64)
    for i in range(components.shape[2]):
        ids, frequencies = np.unique(components[:, :, i], return_counts=True)
        sizes[ids] += frequencies
    largest = float(sizes[1:].max() * np.prod(spacing) / 1000) if count else 0.0
    del components, sizes
    require(count == c['metrics']['componentCount'])
    require(math.isclose(largest, c['metrics']['largestComponentMl'], rel_tol=1e-4, abs_tol=1e-6))
    # Recheck after reads so a source change during loading cannot be silently accepted.
    for k, p in zip(('image', 'mask'), paths):
        require(source_hash(p) == c[k + 'Sha256'])
    return ct, gt, spacing


def slice_pixels(ct, gt, index):
    import numpy as np
    gray = np.rint((np.clip(ct[:, :, index], -150, 250) + 150) * (255 / 400)).astype(np.uint8)
    gray = np.flip(gray.T, axis=(0, 1)).copy()
    tumor = np.flip(gt[:, :, index].T, axis=(0, 1))
    rgba = np.zeros((*tumor.shape, 4), dtype=np.uint8)
    rgba[tumor] = [170, 70, 230, 150]
    return gray, rgba


def encode(pixels, fmt):
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, format=fmt, **({'lossless': True, 'method': 0} if fmt == 'WEBP' else {}))
    return buf.getvalue()


def output_path(root, relative):
    root = Path(root).resolve()
    path = root
    for part in relative.split('/'):
        require(part not in ('', '.', '..'))
        path = path / part
        require(not path.is_symlink())
    return path


def export(config_path, root, verify_only=False):
    from PIL import Image
    import numpy as np
    config_path, root = Path(config_path), Path(root).resolve()
    config = validate_config(parse_json(config_path.read_bytes()))
    existing = None
    if verify_only:
        raw, _ = build_snapshot(root)
        existing = parse_json(raw)
    result = {'version': 1, 'localOnly': True, 'caseCount': len(config['cases']), 'windowHu': [-150, 250], 'cases': []}
    for position, c in enumerate(config['cases']):
        print(f"Checking {c['id']} ({position + 1}/{len(config['cases'])})", flush=True)
        ct, gt, spacing = load_case(c, config_path.parent)
        counts = gt.sum(axis=(0, 1)).astype(int).tolist()
        entry = {'id': c['id'], 'sliceCount': ct.shape[2], 'defaultSlice': counts.index(max(counts)) if sum(counts) else ct.shape[2] // 2,
                 'dimensions': list(ct.shape), 'spacing': spacing, 'gtVoxelCount': sum(counts), 'metrics': c['metrics'], 'slices': []}
        for i in range(ct.shape[2]):
            pixels = slice_pixels(ct, gt, i)
            s = {'index': i, 'gtPixels': counts[i], 'width': ct.shape[0], 'height': ct.shape[1]}
            for kind, ext, fmt, data in zip(('ct', 'gt'), ('webp', 'png'), ('WEBP', 'PNG'), pixels):
                rel = f"data/radiomics_web/web/{c['id']}/{kind}/{i:04d}.{ext}"
                s[kind] = rel
                if verify_only:
                    raw = safe_file(root, rel).read_bytes()
                    with Image.open(io.BytesIO(raw)) as im:
                        require(im.format == fmt)
                        decoded = np.asarray(im.convert('RGBA'))
                        if kind == 'ct':
                            expected = np.empty((*data.shape, 4), dtype=np.uint8)
                            expected[:, :, :3] = data[:, :, None]
                            expected[:, :, 3] = 255
                        else:
                            expected = data
                        require(np.array_equal(decoded, expected))
                else:
                    raw = encode(data, fmt)
                    path = output_path(root, rel)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(raw)
                s[kind + 'Sha256'] = sha256(raw)
            entry['slices'].append(s)
        result['cases'].append(entry)
        del ct, gt  # Do not retain the previous case while loading the next.
    validate_manifest(result)
    if verify_only:
        require(result == existing)
    else:
        path = output_path(root, MANIFEST)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Exclusive creation prevents a pre-existing temporary symlink from being followed.
        import tempfile
        fd, name = tempfile.mkstemp(prefix='manifest-', suffix='.json', dir=path.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(result, f, allow_nan=False, separators=(',', ':'))
                f.flush()
                os.fsync(f.fileno())
            os.replace(name, path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
    print('Verification complete' if verify_only else 'Export complete', flush=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', required=True)
    p.add_argument('--root', required=True)
    p.add_argument('--verify-only', action='store_true')
    args = p.parse_args()
    try:
        export(args.config, args.root, args.verify_only)
    except Exception:
        print('Radiomics export/verification failed; check local configuration, sources and imaging dependencies.', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
