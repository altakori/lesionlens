"""Closed public evidence schema bound to the exact comparison manifest bytes."""
import math


def validate(e, manifest, digest):
    def require(v):
        if not v:
            raise ValueError('invalid candidate evidence')
    def keys(v, names):
        require(isinstance(v, dict) and set(v) == set(names.split()))
    def integer(v):
        return type(v) is int and v >= 0
    def number(v):
        return type(v) in (int, float) and math.isfinite(v) and v >= 0
    keys(e, 'version manifestSha256 rules cases')
    require(e['version'] == 'md-evidence-v1' and e['manifestSha256'] == digest)
    require(e['rules'] == {'connectivity': 26, 'match': 'intersection/min(component voxels) >= 0.1', 'overlapThreshold': .1, 'smallMl': 1., 'smallAdditionalRequires': 'larger component in same model', 'clinicalValidation': False})
    keys(e['cases'], ' '.join(c['id'] for c in manifest['cases']))
    order = ['cappyv2', 'cp050', 'baseline']
    for case in manifest['cases']:
        c = e['cases'][case['id']]
        keys(c, 'models missingModels pairs reasons')
        keys(c['models'], ' '.join(case['models']))
        require(c['missingModels'] == [k for k in order if k not in c['models']])
        candidates = {}
        for k, stats in c['models'].items():
            keys(stats, 'componentCount maxVolumeMl totalVolumeMl candidates')
            old = case['models'][k]
            require(integer(stats['componentCount']) and stats['componentCount'] == old['componentCount'] == len(stats['candidates']))
            for field, expected in [('maxVolumeMl', max(old['componentVolumesMl'], default=0)), ('totalVolumeMl', old['volumeMl'])]:
                require(number(stats[field]) and math.isclose(stats[field], expected, abs_tol=1e-9))
            for i, candidate in enumerate(stats['candidates'], 1):
                keys(candidate, 'id voxels volumeMl voxel slice bbox')
                require(candidate['id'] == f'{k}:{i}' and integer(candidate['voxels']) and candidate['voxels'] > 0)
                require(number(candidate['volumeMl']) and math.isclose(candidate['volumeMl'], candidate['voxels'] * math.prod(case['spacing']) / 1000, rel_tol=1e-6))
                require(len(candidate['voxel']) == 3 and len(candidate['bbox']) == 3)
                for axis, v in enumerate(candidate['voxel']):
                    box = candidate['bbox'][axis]
                    require(integer(v) and len(box) == 2 and all(integer(x) for x in box) and 0 <= box[0] <= v <= box[1] < case['dimensions'][axis])
                require(candidate['slice'] == candidate['voxel'][2])
                candidates[candidate['id']] = candidate
            require(math.isclose(sum(x['volumeMl'] for x in stats['candidates']), stats['totalVolumeMl'], abs_tol=1e-9))
        expected_pairs = [[a,b] for i,a in enumerate(order) for b in order[i+1:] if a in c['models'] and b in c['models']]
        require([p['models'] for p in c['pairs']] == expected_pairs)
        expected_reasons = []
        for pair in c['pairs']:
            keys(pair, 'models matches')
            a,b = pair['models']
            require(len({tuple(edge) for edge in pair['matches']}) == len(pair['matches']))
            for edge in pair['matches']:
                require(len(edge) == 2 and all(cid in candidates and cid.startswith(k+':') for cid,k in zip(edge, [a,b])))
            for model, other in ((a,b),(b,a)):
                for candidate in c['models'][model]['candidates']:
                    n = sum(candidate['id'] in edge for edge in pair['matches'])
                    kind = 'unmatched' if n == 0 else 'split-merge' if n > 1 else None
                    if kind:
                        expected_reasons.append({'kind':kind,'model':model,'otherModel':other,'candidateId':candidate['id'], 'voxel':candidate['voxel'],'slice':candidate['slice'], 'smallAdditional':kind == 'unmatched' and candidate['volumeMl'] <= 1 and c['models'][model]['maxVolumeMl'] > candidate['volumeMl']})
        require(c['reasons'] == expected_reasons)
