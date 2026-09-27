"""Retrospective Pareto structure diagnostics; no medical interpretation."""

import argparse
from collections import Counter, defaultdict

from toolkit_common import SOURCE_KINDS, record_cli_argv, ValidationError, number, provenance, read_csv, unique_ids, write_reports

MEASUREMENTS = ('largest_component_ml', 'component_count', 'maximum_3d_diameter_mm',
                'sphericity', 'glcm_joint_entropy_bin25', 'absolute_tumor_liver_contrast_hu')
COLUMNS = ('case_id', 'review_group', *MEASUREMENTS, 'review_group_bin50',
           'clinical_urgency', 'sample_stratum', 'interpretation')
AXES = ['largest_component_ml', 'component_count', 'glcm_joint_entropy_bin25',
        '-absolute_tumor_liver_contrast_hu']


def pareto_groups(vectors):
    """Successive nondominated layers, maximizing all coordinates."""
    remaining = set(vectors)
    groups = {}
    level = 1
    while remaining:
        front = [a for a in remaining if not any(
            all(x >= y for x, y in zip(vectors[b], vectors[a]))
            and any(x > y for x, y in zip(vectors[b], vectors[a]))
            for b in remaining if b != a)]
        for identifier in front:
            groups[identifier] = level
        remaining.difference_update(front)
        level += 1
    return groups


def describe(vectors, groups, axes):
    grouped = defaultdict(list)
    identical = defaultdict(list)
    for identifier in sorted(groups):
        grouped[groups[identifier]].append(identifier)
        identical[vectors[identifier]].append(identifier)
    sizes = {str(group): len(ids) for group, ids in sorted(grouped.items())}
    return {'axes_maximized': axes, 'group_sizes': sizes,
            'largest_group_proportion': max(sizes.values()) / len(groups) if groups else None,
            'groups': {str(g): grouped[g] for g in sorted(grouped)},
            'queue': sorted(groups, key=lambda identifier: (groups[identifier], identifier)),
            'rank_ties': [grouped[g] for g in sorted(grouped) if len(grouped[g]) > 1],
            'identical_vector_ties': sorted([ids for ids in identical.values() if len(ids) > 1])}


def evaluate(path, *, source_kind):
    rows, digest = read_csv(path, COLUMNS)
    if not rows:
        raise ValidationError('Ranking input has no cases')
    unique_ids(rows)
    known, exclusions = {}, []
    for row in rows:
        identifier = row['case_id']
        values = {key: number(row[key], f'{identifier}/{key}', optional=True,
                              integer=key == 'component_count') for key in MEASUREMENTS}
        if values['sphericity'] is not None and values['sphericity'] > 1:
            raise ValidationError(f'{identifier}/sphericity: required value in [0,1]; no clipping or tolerance')
        group = number(row['review_group'], f'{identifier}/review_group', integer=True,
                       positive=True, optional=True)
        bin50 = number(row['review_group_bin50'], f'{identifier}/review_group_bin50',
                       integer=True, positive=True, optional=True)
        if 'display_order' in row:
            number(row['display_order'], f'{identifier}/display_order', integer=True,
                   positive=True, optional=True)
        volume, count = values['largest_component_ml'], values['component_count']
        if volume is not None and volume > 0 and values['maximum_3d_diameter_mm'] == 0:
            raise ValidationError(f'{identifier}: positive volume requires positive diameter when provided')
        if volume == 0 or count == 0:
            if volume != 0 or count != 0 or group is not None or bin50 is not None:
                raise ValidationError(f'{identifier}: inconsistent no-annotation values/groups')
            if any(value not in (None, 0) for value in values.values()):
                raise ValidationError(f'{identifier}: no-annotation measurements must be zero or blank')
            exclusions.append({'case_id': identifier, 'status': 'no_tumor_annotation',
                               'reason': 'blank groups and explicit zero volume/count; not negative diagnosis'})
        elif any(value is None for value in values.values()):
            if group is not None or bin50 is not None:
                raise ValidationError(f'{identifier}: incomplete measurements cannot carry source groups')
            exclusions.append({'case_id': identifier, 'status': 'unknown',
                               'missing_fields': [key for key, value in values.items() if value is None]})
        else:
            if values['maximum_3d_diameter_mm'] == 0 or group is None:
                raise ValidationError(f'{identifier}: annotated cases require positive diameter and review_group')
            known[identifier] = (values, group, bin50)
    vectors = {identifier: (v['largest_component_ml'], v['component_count'],
                           v['glcm_joint_entropy_bin25'], v['absolute_tumor_liver_contrast_hu'].copy_negate())
               for identifier, (v, _, _) in known.items()}
    groups = pareto_groups(vectors)
    mismatches = [identifier for identifier in sorted(known) if known[identifier][1] != groups[identifier]]
    if mismatches:
        raise ValidationError('Source review_group mismatch: ' + ', '.join(mismatches))
    morphology = {identifier: vector[:2] for identifier, vector in vectors.items()}
    paired = [identifier for identifier in sorted(known) if known[identifier][2] is not None]
    transitions = Counter((known[i][1], known[i][2]) for i in paired)
    same = sum(known[i][1] == known[i][2] for i in paired)
    counts = Counter(entry['status'] for entry in exclusions)
    report = {'provenance': provenance(digest, source_kind=source_kind, script='ranking_diagnostics.py', input_path=path), 'input_count': len(rows), 'known_count': len(known),
              'known_case_ids': sorted(known),
              'exclusions': sorted(exclusions, key=lambda entry: entry['case_id']),
              'exclusion_counts': {key: counts[key] for key in ('unknown', 'no_tumor_annotation')},
              'four_axis': describe(vectors, groups, AXES),
              'two_axis_morphology': describe(morphology, pareto_groups(morphology), AXES[:2]),
              'descriptive_queues': {
                  'largest_volume': sorted(known, key=lambda i: (known[i][0]['largest_component_ml'].copy_negate(), i)),
                  'case_id': sorted(known)},
              'bin_width_source_stability': {
                  'kind': 'source_group_comparison_only_not_recomputed_feature_stability',
                  'paired_count': len(paired), 'paired_case_ids': paired,
                  'missing_bin50_case_ids': sorted(set(known) - set(paired)),
                  'same_group_count': same, 'same_group_proportion': same / len(paired) if paired else None,
                  'transitions': [{'bin25_group': a, 'bin50_group': b, 'count': count}
                                  for (a, b), count in sorted(transitions.items())]}}
    return report


def markdown(report):
    lines = ['# 순위 구조 진단 (exploratory)', '',
             '후향적 구조 기술이며 임상 효용·진단을 평가하지 않습니다.',
             f"입력 {report['input_count']} / 순위 코호트 {report['known_count']} / 제외 {report['exclusion_counts']}",
             '주석 없음은 음성 진단이 아닙니다. unknown은 제외 목록에 명시합니다.', '']
    for key in ('four_axis', 'two_axis_morphology'):
        result = report[key]
        lines += [f"- {key}: 그룹 크기 {result['group_sizes']}; 최대 그룹 비율 {result['largest_group_proportion']}",
                  f"  그룹 내 ID 순서 큐: {result['queue']}"]
    lines += ['', 'bin 폭 비교는 원본 그룹 비교만 하며 특징 안정성을 재계산하지 않습니다.',
              '세부 동률·제외·동일 코호트 부피/ID 큐·원본 그룹 전이는 report.json에 있습니다.',
              f"입력 SHA-256: {report['provenance']['input_sha256']}", '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--source-kind', required=True, choices=SOURCE_KINDS)
    parser.add_argument('--output', required=True, help='Report directory')
    args = parser.parse_args()
    try:
        report = evaluate(args.input, source_kind=args.source_kind)
        record_cli_argv(report, __file__)
        write_reports(args.output, report, markdown(report))
    except (ValidationError, OSError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
