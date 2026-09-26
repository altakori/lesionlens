"""Dependency-free, closed public schema for the bounded comparison dataset."""
import math
import re

VERSION = 'lits-model-compare-v4'
MANIFEST = '/data/model_compare/manifest.json'
MODELS = ('baseline', 'cappyv2', 'cp050')
CASES = {'case_000': (75, 2591), 'case_001': (123, 7194), 'case_035': (124, 20318),
         'case_045': (74, 4539), 'case_048': (244, 35478),
         # matched-r3 cohort (ai0 cp050_e1000_test27 + v2_matched_inference_20260916/full_r3)
         'case_005': (537, 540), 'case_049': (254, 8015), 'case_051': (227, 124895),
         'case_057': (366, 6604), 'case_060': (244, 11368), 'case_061': (193, 2916),
         'case_079': (147, 9085), 'case_116': (908, 611132),
         # matched-r3 cohort expansion (2026-09-27, ai0 full_r3 + cp050 test27)
         'case_009': (549, 22179),
         'case_019': (547, 18528),
         'case_020': (574, 1669),
         'case_026': (668, 51809),
         'case_065': (513, 1670),
         'case_080': (217, 88269),
         'case_083': (871, 98),
         'case_088': (811, 254141),
         'case_093': (696, 348088),
         'case_095': (841, 2581),
         'case_102': (677, 47754),
         'case_113': (836, 84270),
         'case_126': (401, 5090),
         'case_129': (338, 1909785),
         # lv2-test20 cohort (ai0 labv2 Dataset003_Liver fold_0 test set, 2 arms)
         'lv2-case_041': (113, 0),
         'lv2-case_089': (766, 0),
         'lv2-case_114': (846, 0),
         'lv2-case_115': (846, 0),
         'lv2-case_117': (836, 1034092),
         'lv2-case_118': (427, 419119),
         'lv2-case_119': (461, 0),
         'lv2-case_120': (424, 5231),
         'lv2-case_121': (463, 2123),
         'lv2-case_122': (422, 79803),
         'lv2-case_123': (432, 228251),
         'lv2-case_125': (410, 754),
         'lv2-case_127': (987, 298),
         'lv2-case_128': (654, 326553),
}
MODEL_VOXELS = {'case_000': (2359, 2483, 2517), 'case_001': (9499, 9968, 10472),
                'case_035': (31587, 8885, 72907), 'case_048': (29641, 30044, 30495),
                'case_005': (915, 482, 564), 'case_049': (18175, 20068, 7080),
                'case_051': (131139, 134716, 136408), 'case_057': (5978, 6728, 6793),
                'case_060': (8159, 8076, 8139), 'case_061': (2230, 2487, 2403),
                'case_079': (8389, 8294, 8741), 'case_116': (0, 0, 17),
                'case_009': (22153, 21981, 23477),
                'case_019': (31898, 31510, 30673),
                'case_020': (8340, 9892, 14803),
                'case_026': (67718, 67227, 69658),
                'case_065': (673, 754, 841),
                'case_080': (71757, 74493, 73674),
                'case_083': (450, 370, 285),
                'case_088': (184392, 200340, 234853),
                'case_093': (383435, 390345, 396030),
                'case_095': (3766, 3874, 8076),
                'case_102': (32672, 32427, 34127),
                'case_113': (106704, 104629, 106500),
                'case_126': (3760, 4224, 5019),
                'case_129': (1799499, 1805493, 1780747),
                'lv2-case_041': (29750, 32791),
                'lv2-case_089': (0, 0),
                'lv2-case_114': (2, 0),
                'lv2-case_115': (66, 29),
                'lv2-case_117': (1066536, 1085419),
                'lv2-case_118': (302721, 323070),
                'lv2-case_119': (0, 0),
                'lv2-case_120': (46966, 8807),
                'lv2-case_121': (153, 980),
                'lv2-case_122': (59705, 69505),
                'lv2-case_123': (235431, 244728),
                'lv2-case_125': (950, 1042),
                'lv2-case_127': (0, 45),
                'lv2-case_128': (409335, 483678),
}


# lv2-test20 has only the baseline/CAPPYv2 arms; case_045 has no model output at all.
def arms_for(case_id):
    if case_id == 'case_045':
        return ()
    return ('baseline', 'cappyv2') if case_id.startswith('lv2-') else MODELS


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
    require(type(manifest['caseCount']) is int and manifest['caseCount'] == len(CASES)
            and manifest['windowHu'] == [-150, 250])
    require(isinstance(manifest['cases'], list) and len(manifest['cases']) == len(CASES))
    assets = {}
    for item, (case_id, (depth, gt_voxels)) in zip(manifest['cases'], CASES.items()):
        keys(item, 'id sourceCaseId sliceCount dimensions spacing tumorVolumeMl defaultSlice gt models disagreement slices')
        require(item['id'] == item['sourceCaseId'] == case_id)
        require(integer(item['sliceCount']) and item['sliceCount'] == depth and item['dimensions'] == [512, 512, depth])
        spacing = item['spacing']
        require(isinstance(spacing, list) and len(spacing) == 3 and all(number(v) and 0 < v < 100 for v in spacing))
        voxel_ml = math.prod(spacing) / 1000
        available = arms_for(case_id)
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
