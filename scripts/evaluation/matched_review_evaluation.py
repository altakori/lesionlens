"""Exploratory matched-cohort per-case FN burden capture, not clinical sensitivity."""

import argparse
from collections import Counter
from fractions import Fraction
import random

from toolkit_common import SOURCE_KINDS, record_cli_argv, ValidationError, number, provenance, read_csv, unique_ids, write_reports

RANKS = ('candidate_rank', 'volume_rank', 'disagreement_rank')
COLUMNS = ('case_id', 'candidate_rank', 'largest_component_ml', 'disagreement_score', 'fn_count')
BASELINES = {'volume_rank': 'largest_component_ml', 'disagreement_rank': 'disagreement_score'}


def quantile(values, probability):
    """Linear interpolation of sorted Monte Carlo samples (not a confidence interval)."""
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def evaluate(path, *, source_kind, evidence_label, budgets=None, seed=None, repeats=None):
    if evidence_label != 'exploratory':
        raise ValidationError('evidence_label must explicitly be exploratory')
    if (seed is None) != (repeats is None):
        raise ValidationError('Monte Carlo requires both explicit seed and repeats')
    if seed is not None and (type(seed) is not int or type(repeats) is not int or repeats < 1):
        raise ValidationError('seed must be integer; repeats must be a positive integer')
    rows, digest = read_csv(path, COLUMNS)
    if not rows:
        raise ValidationError('Matched evaluation requires at least one case')
    unique_ids(rows)
    n = len(rows)
    for row in rows:
        for key in ('candidate_rank', 'fn_count', *(key for key in BASELINES if key in row)):
            row[key] = number(row[key], f"{row['case_id']}/{key}", integer=True, positive=key in RANKS)
        for field in BASELINES.values():
            row[field] = number(row[field], f"{row['case_id']}/{field}")
    for rank, field in BASELINES.items():
        ordered = sorted(rows, key=lambda row: (row[field].copy_negate(), row['case_id']))
        for position, row in enumerate(ordered, 1):
            if rank in row and row[rank] != position:
                raise ValidationError(f"{row['case_id']}/{rank}: inconsistent with descending {field}, case_id ties")
            row[rank] = position
    for key in RANKS:
        if sorted(row[key] for row in rows) != list(range(1, n + 1)):
            raise ValidationError(f'{key}: ranks must be an exact permutation of 1..{n}')
    if budgets is None:
        budgets = list(range(1, n + 1))
    else:
        budgets = list(budgets)
        if not budgets or any(type(k) is not int or not 1 <= k <= n for k in budgets):
            raise ValidationError(f'budgets must be integers in 1..{n}')
        if len(set(budgets)) != len(budgets):
            raise ValidationError('budgets must be unique')
        budgets.sort()
    total = sum(row['fn_count'] for row in rows)
    number(str(total), 'aggregate fn_count', integer=True)
    comparisons = {}
    for key in RANKS:
        ordered = sorted(rows, key=lambda row: row[key])
        cumulative = [0]
        for row in ordered:
            cumulative.append(cumulative[-1] + row['fn_count'])
        comparisons[key] = [{'k': k, 'captured_fn_burden': cumulative[k],
                             'capture_fraction': cumulative[k] / total if total else None}
                            for k in budgets]
    baseline = [{'k': k, 'expected_fn_burden': float(Fraction(total * k, n)),
                 'expected_fn_burden_exact': {'numerator': total * k, 'denominator': n},
                 'expected_capture_fraction': k / n if total else None} for k in budgets]
    simulation = None
    if repeats is not None:
        rng = random.Random(seed)
        # Canonical ID ordering makes seeded results invariant to CSV row order.
        canonical = [row['fn_count'] for row in sorted(rows, key=lambda row: row['case_id'])]
        samples = {k: [] for k in budgets}
        for _ in range(repeats):
            shuffled = canonical.copy()
            rng.shuffle(shuffled)
            cumulative = 0
            for k, burden in enumerate(shuffled, 1):
                cumulative += burden
                if k in samples:
                    samples[k].append(cumulative)
        simulation = {
            'seed': seed, 'repeats': repeats,
            'interval_label': 'Monte Carlo percentile interval; NOT a confidence interval',
            'quantile_method': 'linear interpolation at (repeats - 1) * probability',
            'percentiles': [2.5, 97.5],
            'results': [{'k': k, 'mean_fn_burden': sum(samples[k]) / repeats,
                         'fn_burden_interval': [quantile(samples[k], p) for p in (0.025, 0.975)],
                         'capture_fraction_interval': [quantile(samples[k], p) / total for p in (0.025, 0.975)]
                         if total else None,
                         'burden_frequency': {str(value): count for value, count in sorted(Counter(samples[k]).items())}}
                        for k in budgets]}
    options = ['--evidence-label', evidence_label, '--budgets', ','.join(map(str, budgets))]
    if seed is not None:
        options += ['--seed', str(seed), '--repeats', str(repeats)]
    source = provenance(digest, source_kind=source_kind, script='matched_review_evaluation.py',
                        input_path=path, options=options)
    source.update({'label_origin': 'user_supplied_independently_computed_labels_required',
                   'label_generation_verified': False, 'project_metric_contract_verified': False,
                   'labels_constructed_from_ranking_features': False})
    return {'provenance': source, 'metric': 'per_case_FN_burden_capture_not_clinical_sensitivity',
            'case_count': n, 'matched_case_ids': sorted(row['case_id'] for row in rows),
            'budgets': budgets, 'total_fn_burden': total,
            'capture_status': 'defined' if total else 'undefined_total_fn_zero',
            'baseline_contract': {'fields': BASELINES, 'order': 'descending measurement; ascending case_id ties',
                                  'provided_baseline_ranks': 'optional; must match computed ranks'},
            'rank_queues': {key: [row['case_id'] for row in sorted(rows, key=lambda row: row[key])]
                            for key in RANKS},
            'comparisons': comparisons, 'uniform_random_exact_expectation': baseline,
            'monte_carlo': simulation}


def markdown(report):
    lines = ['# 동일 코호트 FN 부담 평가 (exploratory)', '',
             '**사례별 FN 부담 포착률이며 임상 민감도가 아닙니다.**',
             '라벨은 프로젝트 지표 계약에 따라 독립 계산해야 합니다. 분할·라벨 독립성은 검증하지 않았습니다.',
             f"사례 수: {report['case_count']}; 총 FN: {report['total_fn_burden']}; 상태: {report['capture_status']}", '',
             '| k | 후보 부담/비율 | 부피 부담/비율 | 불일치 부담/비율 | 균등 무작위 기대 부담 |',
             '| --- | --- | --- | --- | --- |']
    for index, k in enumerate(report['budgets']):
        cells = []
        for key in RANKS:
            value = report['comparisons'][key][index]
            fraction = value['capture_fraction']
            cells.append(f"{value['captured_fn_burden']}/{fraction if fraction is not None else 'undefined'}")
        expected = report['uniform_random_exact_expectation'][index]['expected_fn_burden']
        lines.append(f"| {k} | {' | '.join(cells)} | {expected} |")
    if report['monte_carlo']:
        mc = report['monte_carlo']
        lines += ['', f"Monte Carlo seed={mc['seed']}, repeats={mc['repeats']}; 2.5–97.5 백분위 구간은 신뢰구간이 아닙니다.",
                  '구간 및 경험 분포는 report.json에 있습니다.']
    lines += ['', f"입력 SHA-256: {report['provenance']['input_sha256']}", '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--source-kind', required=True, choices=SOURCE_KINDS)
    parser.add_argument('--output', required=True, help='Report directory')
    parser.add_argument('--evidence-label', required=True, choices=['exploratory'])
    parser.add_argument('--budgets', help='Comma-separated unique integers, default all 1..N')
    parser.add_argument('--seed', type=int)
    parser.add_argument('--repeats', type=int)
    args = parser.parse_args()
    try:
        budgets = [int(part) for part in args.budgets.split(',')] if args.budgets is not None else None
        report = evaluate(args.input, source_kind=args.source_kind, evidence_label=args.evidence_label, budgets=budgets,
                          seed=args.seed, repeats=args.repeats)
        record_cli_argv(report, __file__)
        write_reports(args.output, report, markdown(report))
    except (ValueError, OSError) as exc:
        parser.error(str(exc))


if __name__ == '__main__':
    main()
