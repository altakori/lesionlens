"""Dependency-free, closed public schema for the bounded comparison dataset."""
import math
import re

VERSION = 'lits-model-compare-v1'
MANIFEST = '/data/model_compare/manifest.json'
MODELS = ('baseline', 'cappyv2', 'cp050')
CASES = {'case_000': (75, 2591), 'case_001': (123, 7194), 'case_035': (124, 20318),
         'case_045': (74, 4539), 'case_048': (244, 35478)}
MODEL_VOXELS = {'case_000': (2359, 2483, 2517), 'case_001': (9499, 9968, 10472),
                'case_035': (31587, 8885, 72907), 'case_048': (29641, 30044, 30495)}


def require(value):
    if not value:
        raise ValueError('invalid comparison manifest')


def keys(value, names):
    require(isinstance(value, dict) and set(value) == set(names.split()))


def integer(value, low=0, high=512 * 512 * 244):
    return type(value) is int and low <= value <= high


def number(value, low=0, high=float('inf')):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def validate_stats(stats, areas, voxel_ml, expected):
    keys(stats, 'voxels volumeMl componentVolumesMl componentCount positiveSliceCount sliceSpan')
    require(integer(stats['voxels']) and stats['voxels'] == sum(areas) == expected)
    require(number(stats['volumeMl']) and math.isclose(stats['volumeMl'], expected * voxel_ml, rel_tol=1e-6))
    components = stats['componentVolumesMl']
    require(isinstance(components, list) and all(number(v) and v > 0 for v in components))
    require(integer(stats['componentCount']) and stats['componentCount'] == len(components))
    require((len(components) > 0) == (expected > 0) and len(components) <= expected)
    require(math.isclose(sum(components), stats['volumeMl'], rel_tol=1e-6))
    require(all(math.isclose(v / voxel_ml, round(v / voxel_ml), abs_tol=1e-5) for v in components))
    positive = [i + 1 for i, area in enumerate(areas) if area]
    require(integer(stats['positiveSliceCount']) and stats['positiveSliceCount'] == len(positive))
    require(stats['sliceSpan'] == ([positive[0], positive[-1]] if positive else None))


def validate_manifest(manifest):
    keys(manifest, 'version localOnly caseCount windowHu cases')
    require(manifest['version'] == VERSION and manifest['localOnly'] is True)
    require(type(manifest['caseCount']) is int and manifest['caseCount'] == 5 and manifest['windowHu'] == [-150, 250])
    require(isinstance(manifest['cases'], list) and len(manifest['cases']) == 5)
    assets = {}
    for item, (case_id, (depth, gt_voxels)) in zip(manifest['cases'], CASES.items()):
        keys(item, 'id sourceCaseId sliceCount dimensions spacing tumorVolumeMl defaultSlice gt models disagreement slices')
        require(item['id'] == item['sourceCaseId'] == case_id)
        require(integer(item['sliceCount']) and item['sliceCount'] == depth and item['dimensions'] == [512, 512, depth])
        spacing = item['spacing']
        require(isinstance(spacing, list) and len(spacing) == 3 and all(number(v) and 0 < v < 100 for v in spacing))
        voxel_ml = math.prod(spacing) / 1000
        available = () if case_id == 'case_045' else MODELS
        keys(item['models'], ' '.join(available))
        rows = item['slices']
        require(isinstance(rows, list) and len(rows) == depth)
        areas = {kind: [] for kind in ('gt', *available)}
        for z, row in enumerate(rows):
            keys(row, 'index canonicalSlice width height gtPixels ct ctSha256 overlays pixels')
            require(integer(row['index']) and row['index'] == z + 1 and integer(row['canonicalSlice']) and row['canonicalSlice'] == z)
            require(type(row['width']) is int and row['width'] == 512 and type(row['height']) is int and row['height'] == 512)
            keys(row['overlays'], ' '.join(areas))
            keys(row['pixels'], ' '.join(areas))
            for kind in areas:
                require(integer(row['pixels'][kind], high=512 * 512))
                areas[kind].append(row['pixels'][kind])
            require(type(row['gtPixels']) is int and row['gtPixels'] == row['pixels']['gt'])
            entries = {'ct': {'path': row['ct'], 'sha256': row['ctSha256']}, **row['overlays']}
            for kind, entry in entries.items():
                keys(entry, 'path sha256')
                path = f'data/model_compare/web/{case_id}/{kind}/{z + 1:03d}.{"webp" if kind == "ct" else "png"}'
                require(entry['path'] == path and isinstance(entry['sha256'], str) and re.fullmatch('[0-9a-f]{64}', entry['sha256']) is not None)
                assets['/' + path] = entry['sha256']
        validate_stats(item['gt'], areas['gt'], voxel_ml, gt_voxels)
        require(number(item['tumorVolumeMl']) and item['tumorVolumeMl'] == item['gt']['volumeMl'])
        require(integer(item['defaultSlice']) and item['defaultSlice'] == areas['gt'].index(max(areas['gt'])))
        for kind, expected in zip(available, MODEL_VOXELS.get(case_id, ())):
            validate_stats(item['models'][kind], areas[kind], voxel_ml, expected)
        disagreement = item['disagreement']
        if not available:
            require(disagreement is None)
        else:
            keys(disagreement, 'intersectionVoxels unionVoxels score')
            intersection, union = disagreement['intersectionVoxels'], disagreement['unionVoxels']
            counts = MODEL_VOXELS[case_id]
            require(integer(intersection) and integer(union) and intersection <= min(counts) <= max(counts) <= union <= sum(counts))
            require(number(disagreement['score'], 0, 1) and math.isclose(disagreement['score'], 1 - intersection / union if union else 0, abs_tol=1e-12))
    return assets
