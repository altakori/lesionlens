"""Strict public radiomics contract; no private source metadata belongs here."""
import hashlib
import json
import math
import re
from pathlib import Path

MANIFEST = 'data/radiomics_web/manifest.json'
METRICS = {'reviewGroup', 'reviewGroupBin50', 'largestComponentMl', 'componentCount', 'maxDiameterMm', 'sphericity', 'entropy', 'contrastHu'}
NULLABLE = METRICS - {'largestComponentMl', 'componentCount'}


def require(ok):
    if not ok:
        raise ValueError('Invalid radiomics data')


def keys(obj, expected):
    require(type(obj) is dict and set(obj) == set(expected))


def number(v, minimum=0):
    return type(v) in (int, float) and math.isfinite(v) and v >= minimum


def integer(v, minimum=0):
    return type(v) is int and v >= minimum


def digest(v):
    return type(v) is str and re.fullmatch(r'[0-9a-f]{64}', v) is not None


def case_id(v):
    return type(v) is str and re.fullmatch(r'case_[0-9]{3}', v) is not None


def validate_metrics(m):
    keys(m, METRICS)
    require(integer(m['componentCount']) and number(m['largestComponentMl']))
    if m['componentCount'] == 0:
        require(m['largestComponentMl'] == 0 and all(m[k] is None for k in NULLABLE))
    else:
        require(m['largestComponentMl'] > 0)
        require(all(number(m[k]) for k in NULLABLE))
        require(integer(m['reviewGroup'], 1) and integer(m['reviewGroupBin50'], 1))
        require(m['sphericity'] <= 1)


def pareto_groups(cases, morphology=False):
    remaining = [c for c in cases if c['metrics']['componentCount'] > 0]
    result, rank = {}, 1
    def axes(c):
        m = c['metrics']
        a = [m['largestComponentMl'], m['componentCount']]
        return a if morphology else a + [m['entropy'], -m['contrastHu']]
    while remaining:
        front = []
        for c in remaining:
            a = axes(c)
            if not any(all(x >= y for x, y in zip(axes(d), a)) and any(x > y for x, y in zip(axes(d), a)) for d in remaining):
                front.append(c)
        for c in front:
            result[c['id']] = rank
        remaining = [c for c in remaining if c['id'] not in result]
        rank += 1
    return result


def validate_groups(cases):
    groups = pareto_groups(cases)
    require(all(c['metrics']['reviewGroup'] == groups.get(c['id']) for c in cases))


def validate_manifest(m):
    keys(m, {'version', 'localOnly', 'caseCount', 'windowHu', 'cases'})
    require(type(m['version']) is int and m['version'] == 1 and m['localOnly'] is True)
    require(m['windowHu'] == [-150, 250] and all(type(x) is int for x in m['windowHu']))
    require(type(m['cases']) is list and integer(m['caseCount'], 1) and m['caseCount'] == len(m['cases']) <= 100)
    seen = set()
    for c in m['cases']:
        keys(c, {'id', 'sliceCount', 'defaultSlice', 'dimensions', 'spacing', 'gtVoxelCount', 'metrics', 'slices'})
        require(case_id(c['id']) and c['id'] not in seen)
        seen.add(c['id'])
        require(integer(c['sliceCount'], 1) and c['sliceCount'] <= 10000)
        require(integer(c['defaultSlice']) and c['defaultSlice'] < c['sliceCount'])
        require(type(c['dimensions']) is list and len(c['dimensions']) == 3 and all(integer(x, 1) for x in c['dimensions']))
        require(c['dimensions'][2] == c['sliceCount'])
        require(type(c['spacing']) is list and len(c['spacing']) == 3 and all(number(x) and x > 0 for x in c['spacing']))
        require(integer(c['gtVoxelCount']))
        validate_metrics(c['metrics'])
        require(type(c['slices']) is list and len(c['slices']) == c['sliceCount'])
        for i, s in enumerate(c['slices']):
            keys(s, {'index', 'ct', 'gt', 'ctSha256', 'gtSha256', 'gtPixels', 'width', 'height'})
            require(integer(s['index']) and s['index'] == i)
            require(integer(s['width'], 1) and integer(s['height'], 1))
            require([s['width'], s['height']] == c['dimensions'][:2])
            require(integer(s['gtPixels']) and s['gtPixels'] <= s['width'] * s['height'])
            for kind, ext in [('ct', 'webp'), ('gt', 'png')]:
                require(s[kind] == f"data/radiomics_web/web/{c['id']}/{kind}/{i:04d}.{ext}")
                require(digest(s[kind + 'Sha256']))
        counts = [s['gtPixels'] for s in c['slices']]
        require(sum(counts) == c['gtVoxelCount'])
        require((c['gtVoxelCount'] > 0) == (c['metrics']['componentCount'] > 0))
        require(c['metrics']['componentCount'] <= c['gtVoxelCount'])
        require(c['defaultSlice'] == (counts.index(max(counts)) if sum(counts) else c['sliceCount'] // 2))
    validate_groups(m['cases'])
    return m


def parse_json(raw):
    def pairs(items):
        out = {}
        for k, v in items:
            require(k not in out)
            out[k] = v
        return out
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: require(False))


def safe_file(root, relative):
    root = Path(root).resolve()
    require(type(relative) is str and relative and '\\' not in relative)
    parts = relative.split('/')
    require(all(p not in ('', '.', '..') for p in parts))
    path = root
    for part in parts:
        path = path / part
        require(not path.is_symlink())
    require(path.is_file() and path.resolve().is_relative_to(root))
    return path


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def build_snapshot(root):
    raw = safe_file(root, MANIFEST).read_bytes()
    m = validate_manifest(parse_json(raw))
    assets = {}
    for c in m['cases']:
        for s in c['slices']:
            for kind in ('ct', 'gt'):
                require(sha256(safe_file(root, s[kind]).read_bytes()) == s[kind + 'Sha256'])
                assets['/' + s[kind]] = s[kind + 'Sha256']
    return raw, assets
