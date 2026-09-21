"""Provisional model-only 3D component correspondence; never uses GT."""
import numpy as np
from scipy import ndimage

MODELS = ('cappyv2', 'cp050', 'baseline')
RULES = {'connectivity': 26, 'match': 'intersection/min(component voxels) >= 0.1',
         'overlapThreshold': 0.1, 'smallMl': 1.0,
         'smallAdditionalRequires': 'larger component in same model', 'clinicalValidation': False}


def compare(masks, voxel_ml):
    if not np.isfinite(voxel_ml) or voxel_ml <= 0:
        raise ValueError('invalid voxel volume')
    available = {k: np.asarray(masks[k], dtype=bool) for k in MODELS if k in masks}
    if any(a.ndim != 3 for a in available.values()) or len({a.shape for a in available.values()}) > 1:
        raise ValueError('unaligned full 3D masks')
    labels, models = {}, {}
    for key, mask in available.items():
        lab, count = ndimage.label(mask, structure=np.ones((3, 3, 3)))
        labels[key] = lab
        components = []
        for i, box in enumerate(ndimage.find_objects(lab), 1):
            points = np.argwhere(lab[box] == i) + np.array([s.start for s in box])
            # Representative voxel lies inside the component, unlike a centroid.
            voxel = points[len(points) // 2].tolist()
            components.append({'id': f'{key}:{i}', 'voxels': len(points), 'volumeMl': len(points) * voxel_ml,
                               'voxel': voxel, 'slice': voxel[2],
                               'bbox': [[s.start, s.stop - 1] for s in box]})
        volumes = [c['volumeMl'] for c in components]
        models[key] = {'componentCount': count, 'maxVolumeMl': max(volumes, default=0),
                       'totalVolumeMl': sum(volumes), 'candidates': components}
    pairs, reasons = [], []
    for ai, a in enumerate(available):
        for b in list(available)[ai + 1:]:
            edges = []
            for ca in models[a]['candidates']:
                overlaps = np.bincount(labels[b][labels[a] == int(ca['id'].split(':')[1])])
                for cb in models[b]['candidates']:
                    bi = int(cb['id'].split(':')[1])
                    overlap = int(overlaps[bi]) if bi < len(overlaps) else 0
                    if overlap / min(ca['voxels'], cb['voxels']) >= RULES['overlapThreshold']:
                        edges.append([ca['id'], cb['id']])
            pairs.append({'models': [a, b], 'matches': edges})
            for model, other in ((a, b), (b, a)):
                for c in models[model]['candidates']:
                    links = [edge for edge in edges if c['id'] in edge]
                    kind = 'unmatched' if not links else 'split-merge' if len(links) > 1 else None
                    if kind:
                        reasons.append({'kind': kind, 'model': model, 'otherModel': other,
                                        'candidateId': c['id'], 'voxel': c['voxel'], 'slice': c['slice'],
                                        'smallAdditional': kind == 'unmatched' and c['volumeMl'] <= RULES['smallMl'] and models[model]['maxVolumeMl'] > c['volumeMl']})
    return {'models': models, 'missingModels': [k for k in MODELS if k not in available],
            'pairs': pairs, 'reasons': reasons}
