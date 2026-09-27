"""Independent hand-worked synthetic expectations; no real records."""

import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import matched_review_evaluation as matched
import ranking_diagnostics as ranking
import usability_records as usability
from toolkit_common import ValidationError

ROOT = Path(__file__).resolve().parents[1]


class FixtureCase(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='synthetic-test-', dir=ROOT)
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'input.csv'

    def ranking_evaluate(self, path, **kwargs):
        return ranking.evaluate(path, source_kind='synthetic', **kwargs)

    def matched_evaluate(self, path, **kwargs):
        return matched.evaluate(path, source_kind='synthetic', **kwargs)

    def usability_evaluate(self, path, **kwargs):
        return usability.evaluate(path, source_kind='synthetic', **kwargs)

    def write(self, columns, rows):
        if tuple(columns) == matched.COLUMNS:
            columns = (*columns, *(key for key in matched.BASELINES if any(key in row for row in rows)))
        with self.path.open('w', newline='', encoding='utf-8') as stream:
            writer = csv.DictWriter(stream, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
        return self.path

    def cli(self, script, *arguments):
        return subprocess.run([sys.executable, str(ROOT / script), '--source-kind', 'synthetic', *map(str, arguments)],
                              cwd=ROOT, capture_output=True, text=True)


def rank_row(identifier='A', group=1, volume=10, count=2, entropy=3, contrast=4, **overrides):
    row = dict(zip(ranking.COLUMNS, [''] * len(ranking.COLUMNS)))
    row.update(case_id=identifier, review_group=group, largest_component_ml=volume,
               component_count=count, maximum_3d_diameter_mm=5, sphericity=0.5,
               glcm_joint_entropy_bin25=entropy, absolute_tumor_liver_contrast_hu=contrast,
               review_group_bin50=group)
    row.update(overrides)
    return row


class RankingTests(FixtureCase):
    def evaluate(self, rows):
        return self.ranking_evaluate(self.write(ranking.COLUMNS, rows))

    def test_hand_worked_dominance_layers_and_same_cohort_queues(self):
        # A dominates B; B dominates C. Smaller contrast is prioritized.
        report = self.evaluate([rank_row('C', 3, 2, 1, 1, 8),
                                rank_row('A', 1, 10, 3, 5, 2),
                                rank_row('B', 2, 5, 2, 3, 4)])
        self.assertEqual(report['four_axis']['groups'], {'1': ['A'], '2': ['B'], '3': ['C']})
        self.assertEqual(report['four_axis']['group_sizes'], {'1': 1, '2': 1, '3': 1})
        self.assertEqual(report['four_axis']['largest_group_proportion'], 1 / 3)
        self.assertEqual(report['two_axis_morphology']['groups'], report['four_axis']['groups'])
        self.assertEqual(report['descriptive_queues'], {'largest_volume': ['A', 'B', 'C'], 'case_id': ['A', 'B', 'C']})
        self.assertEqual(report['provenance']['input_sha256'], hashlib.sha256(self.path.read_bytes()).hexdigest())

    def test_contrast_direction(self):
        result = self.evaluate([rank_row('A', 2, contrast=10), rank_row('B', 1, contrast=1)])
        self.assertEqual(result['four_axis']['queue'], ['B', 'A'])
        self.assertEqual(result['two_axis_morphology']['group_sizes'], {'1': 2})

    def test_identical_vectors_and_tradeoffs_are_distinct(self):
        result = self.evaluate([rank_row('Z'), rank_row('A'), rank_row('B', volume=9, entropy=4)])
        self.assertEqual(result['four_axis']['rank_ties'], [['A', 'B', 'Z']])
        self.assertEqual(result['four_axis']['identical_vector_ties'], [['A', 'Z']])
        self.assertEqual(result['four_axis']['largest_group_proportion'], 1)
        self.assertEqual(result['two_axis_morphology']['groups'], {'1': ['A', 'Z'], '2': ['B']})
        self.assertEqual(result['descriptive_queues']['largest_volume'], ['A', 'Z', 'B'])
        self.assertEqual(result['descriptive_queues']['case_id'], ['A', 'B', 'Z'])

    def test_extra_axes_can_increase_group_ties(self):
        result = self.evaluate([rank_row('A', volume=10, count=3, entropy=1),
                                rank_row('B', volume=5, count=1, entropy=4)])
        self.assertEqual(result['four_axis']['group_sizes'], {'1': 2})
        self.assertEqual(result['two_axis_morphology']['group_sizes'], {'1': 1, '2': 1})

    def test_source_mismatch_fails(self):
        with self.assertRaisesRegex(ValidationError, 'mismatch: B'):
            self.evaluate([rank_row('A'), rank_row('B', 2)])

    def test_bin_width_is_partial_source_comparison(self):
        result = self.evaluate([rank_row('A', review_group_bin50=2),
                                rank_row('B'), rank_row('C', review_group_bin50='')])
        stability = result['bin_width_source_stability']
        self.assertEqual(stability['paired_case_ids'], ['A', 'B'])
        self.assertEqual(stability['missing_bin50_case_ids'], ['C'])
        self.assertEqual(stability['same_group_proportion'], 0.5)
        self.assertEqual(stability['transitions'], [{'bin25_group': 1, 'bin50_group': 1, 'count': 1},
                                                    {'bin25_group': 1, 'bin50_group': 2, 'count': 1}])
        self.assertIn('not_recomputed', stability['kind'])

    def test_zero_annotation_vs_unknown_explicit_exclusions(self):
        zero = rank_row('Z', '', 0, 0, 0, 0, maximum_3d_diameter_mm=0, sphericity='', review_group_bin50='')
        unknown = rank_row('U', '', '', '', '', '', maximum_3d_diameter_mm='', sphericity='', review_group_bin50='')
        result = self.evaluate([zero, unknown, rank_row('K')])
        self.assertEqual(result['known_case_ids'], ['K'])
        self.assertEqual(result['exclusion_counts'], {'unknown': 1, 'no_tumor_annotation': 1})
        self.assertEqual([entry['case_id'] for entry in result['exclusions']], ['U', 'Z'])
        self.assertEqual(result['descriptive_queues']['case_id'], ['K'])
        empty_cohort = self.evaluate([zero, unknown])
        self.assertIsNone(empty_cohort['four_axis']['largest_group_proportion'])
        self.assertEqual(empty_cohort['four_axis']['queue'], [])
        self.assertIsNone(empty_cohort['bin_width_source_stability']['same_group_proportion'])

    def test_incomplete_features_are_visible_unknown(self):
        result = self.evaluate([rank_row(review_group='', review_group_bin50='', sphericity='')])
        self.assertEqual(result['exclusions'][0]['missing_fields'], ['sphericity'])
        self.assertEqual(result['exclusion_counts']['unknown'], 1)

    def test_invalid_numeric_values_every_measurement(self):
        for field in ranking.MEASUREMENTS:
            for value in ('-1', 'NaN', 'inf', '-Infinity', 'abc', '1e999'):
                with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                    self.evaluate([rank_row(**{field: value})])

    def test_invalid_groups(self):
        for field in ('review_group', 'review_group_bin50'):
            for value in ('0', '-1', '1.5', 'NaN', 'inf', 'abc'):
                with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                    self.evaluate([rank_row(**{field: value})])

    def test_integer_count_and_required_positive_values(self):
        for overrides in ({'component_count': '1.5'}, {'maximum_3d_diameter_mm': 0},
                          {'review_group': ''}, {'largest_component_ml': 0}, {'component_count': 0},
                          {'sphericity': ''}):
            with self.subTest(overrides=overrides), self.assertRaises(ValidationError):
                self.evaluate([rank_row(**overrides)])

    def test_inconsistent_no_annotation_fails(self):
        base = rank_row(group='', volume=0, count=0, entropy=0, contrast=0,
                        maximum_3d_diameter_mm=0, sphericity=0, review_group_bin50='')
        for overrides in ({'review_group': 1}, {'review_group_bin50': 1}, {'largest_component_ml': ''},
                          {'component_count': 1}, {'sphericity': 0.2}):
            with self.subTest(overrides=overrides), self.assertRaises(ValidationError):
                self.evaluate([{**base, **overrides}])

    def test_zero_nonpositive_axes_allowed(self):
        result = self.evaluate([rank_row(entropy=0, contrast=0, sphericity=0)])
        self.assertEqual(result['known_count'], 1)

    def test_sphericity_exact_bounds_without_mutation(self):
        for value in ('0', '1', '0.99999999999999999999999999999'):
            with self.subTest(value=value):
                self.evaluate([rank_row(sphericity=value)])
                self.assertIn(value, self.path.read_text())
        for value in ('-0.00000000000000000001', '1.00000000000000000001', '2'):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.evaluate([rank_row(sphericity=value)])

    def test_duplicates_empty_id_and_empty_input(self):
        for rows in ([], [rank_row('')], [rank_row('A'), rank_row(' A ')]):
            with self.subTest(rows=rows), self.assertRaises(ValidationError):
                self.evaluate(rows)

    def test_missing_column(self):
        with self.assertRaisesRegex(ValidationError, 'Missing columns'):
            self.ranking_evaluate(self.write(['case_id'], [{'case_id': 'A'}]))

    def test_display_order_does_not_control_queue(self):
        result = self.ranking_evaluate(self.write((*ranking.COLUMNS, 'display_order'),
                                             [rank_row('B', display_order=1), rank_row('A', display_order=2)]))
        self.assertEqual(result['four_axis']['queue'], ['A', 'B'])
        with self.assertRaises(ValidationError):
            self.ranking_evaluate(self.write((*ranking.COLUMNS, 'display_order'), [rank_row(display_order=-1)]))

    def test_exact_decimal_ties_and_dominance(self):
        result = self.evaluate([rank_row('A', 1, volume='1.00000000000000001'),
                                rank_row('B', 2, volume='1.00000000000000000')])
        self.assertEqual(result['four_axis']['queue'], ['A', 'B'])

    def test_negation_does_not_round_long_decimals(self):
        result = self.evaluate([rank_row('A', 2, contrast='1.00000000000000000000000000001'),
                                rank_row('B', 1, contrast='1.00000000000000000000000000000')])
        self.assertEqual(result['four_axis']['queue'], ['B', 'A'])
        result = self.evaluate([rank_row('A', 2, volume='1.00000000000000000000000000000'),
                                rank_row('B', 1, volume='1.00000000000000000000000000001')])
        self.assertEqual(result['descriptive_queues']['largest_volume'], ['B', 'A'])

    def test_ranking_cli_outputs(self):
        self.write(ranking.COLUMNS, [rank_row()])
        output = self.path.parent / 'reports'
        process = self.cli('ranking_diagnostics.py', '--input', self.path, '--output', output)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(json.loads((output / 'report.json').read_text())['known_count'], 1)
        self.assertIn('exploratory', (output / 'report.md').read_text())


def evaluation_rows():
    # A has burden 4, B has 1, C has 0; three independent provided permutations.
    return [dict(case_id='A', candidate_rank=1, volume_rank=3, disagreement_rank=2, largest_component_ml=1, disagreement_score=2, fn_count=4),
            dict(case_id='B', candidate_rank=2, volume_rank=2, disagreement_rank=1, largest_component_ml=2, disagreement_score=3, fn_count=1),
            dict(case_id='C', candidate_rank=3, volume_rank=1, disagreement_rank=3, largest_component_ml=3, disagreement_score=1, fn_count=0)]


class MatchedTests(FixtureCase):
    def evaluate(self, rows=None, **kwargs):
        return self.matched_evaluate(self.write(matched.COLUMNS, evaluation_rows() if rows is None else rows),
                                evidence_label='exploratory', **kwargs)

    def test_independent_hand_expected_burdens_and_fractions(self):
        result = self.evaluate()
        self.assertEqual(result['budgets'], [1, 2, 3])
        for name, burdens, fractions in [('candidate_rank', [4, 5, 5], [0.8, 1, 1]),
                                         ('volume_rank', [0, 1, 5], [0, 0.2, 1]),
                                         ('disagreement_rank', [1, 5, 5], [0.2, 1, 1])]:
            self.assertEqual([r['captured_fn_burden'] for r in result['comparisons'][name]], burdens)
            self.assertEqual([r['capture_fraction'] for r in result['comparisons'][name]], fractions)
        for item, expected in zip(result['uniform_random_exact_expectation'], [5 / 3, 10 / 3, 5]):
            self.assertAlmostEqual(item['expected_fn_burden'], expected)
        self.assertEqual(result['uniform_random_exact_expectation'][0]['expected_fn_burden_exact'],
                         {'numerator': 5, 'denominator': 3})
        self.assertFalse(result['provenance']['independent_split_verified'])
        self.assertFalse(result['provenance']['label_generation_verified'])
        self.assertEqual(result['matched_case_ids'], ['A', 'B', 'C'])

    def test_reversed_baseline_permutations_rejected(self):
        for field in ('volume_rank', 'disagreement_rank'):
            rows = evaluation_rows()
            for row in rows:
                row[field] = 4 - row[field]
            with self.subTest(field=field), self.assertRaisesRegex(ValidationError, 'inconsistent'):
                self.evaluate(rows)

    def test_compute_baselines_from_measurements_without_supplied_ranks(self):
        rows = [{key: value for key, value in row.items() if key not in matched.BASELINES}
                for row in evaluation_rows()]
        result = self.evaluate(rows)
        self.assertEqual(result['rank_queues']['volume_rank'], ['C', 'B', 'A'])
        self.assertEqual(result['rank_queues']['disagreement_rank'], ['B', 'A', 'C'])
        self.assertEqual([r['captured_fn_burden'] for r in result['comparisons']['volume_rank']], [0, 1, 5])

    def test_baseline_measurement_ties_use_case_id(self):
        rows = [{key: value for key, value in row.items() if key not in matched.BASELINES}
                for row in reversed(evaluation_rows())]
        for row in rows:
            row['largest_component_ml'] = '1.00000000000000000000000000000'
            row['disagreement_score'] = 0
        rows[0]['largest_component_ml'] = '1.00000000000000000000000000001'  # C
        result = self.evaluate(rows)
        self.assertEqual(result['rank_queues']['volume_rank'], ['C', 'A', 'B'])
        self.assertEqual(result['rank_queues']['disagreement_rank'], ['A', 'B', 'C'])

    def test_baseline_measurements_required_and_validated(self):
        for field in matched.BASELINES.values():
            for value in ('', '-1', 'NaN', 'inf'):
                rows = evaluation_rows()
                rows[0][field] = value
                with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                    self.evaluate(rows)
            columns = [key for key in matched.COLUMNS if key != field]
            with self.subTest(field=field), self.assertRaisesRegex(ValidationError, field):
                self.matched_evaluate(self.write(columns, []), evidence_label='exploratory')

    def test_zero_total_fn_is_undefined(self):
        result = self.evaluate([{**r, 'fn_count': 0} for r in evaluation_rows()], seed=0, repeats=5)
        self.assertEqual(result['capture_status'], 'undefined_total_fn_zero')
        for comparison in result['comparisons'].values():
            self.assertTrue(all(r['capture_fraction'] is None and r['captured_fn_burden'] == 0 for r in comparison))
        self.assertTrue(all(r['expected_capture_fraction'] is None for r in result['uniform_random_exact_expectation']))
        self.assertTrue(all(r['capture_fraction_interval'] is None for r in result['monte_carlo']['results']))

    def test_empty_or_invalid_fn_never_zero_filled(self):
        for value in ('', '-1', '1.2', 'NaN', 'inf', 'text', '1e999'):
            rows = evaluation_rows()
            rows[0]['fn_count'] = value
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.evaluate(rows)

    def test_aggregate_fn_overflow_fails_clearly(self):
        with self.assertRaisesRegex(ValidationError, 'aggregate fn_count'):
            self.evaluate([{**r, 'fn_count': '1e308'} for r in evaluation_rows()])

    def test_all_rank_columns_exact_permutations(self):
        for key in matched.RANKS:
            for value in ('', '0', '2', '4', '1.5', 'NaN', 'inf', '-1'):
                rows = evaluation_rows()
                # Force a missing, duplicate or invalid rank by modifying rank-1 row.
                next(row for row in rows if row[key] == 1)[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(ValidationError):
                    self.evaluate(rows)

    def test_empty_input_duplicates_blank_id(self):
        for rows in ([], [evaluation_rows()[0]] * 2, [{**evaluation_rows()[0], 'case_id': ''}]):
            with self.subTest(rows=rows), self.assertRaises(ValidationError):
                self.evaluate(rows)

    def test_missing_label_column(self):
        columns = [c for c in matched.COLUMNS if c != 'fn_count']
        with self.assertRaisesRegex(ValidationError, 'fn_count'):
            self.matched_evaluate(self.write(columns, []), evidence_label='exploratory')

    def test_budgets_validation_and_selection(self):
        self.assertEqual(self.evaluate(budgets=[3, 1])['budgets'], [1, 3])
        for values in ([], [0], [4], [-1], [1, 1], [1.5], [True], ['1']):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                self.evaluate(budgets=values)

    def test_simulation_parameters(self):
        for kwargs in ({'seed': 1}, {'repeats': 10}, {'seed': 1, 'repeats': 0},
                       {'seed': 1, 'repeats': -1}, {'seed': 1, 'repeats': 1.2}, {'seed': '1', 'repeats': 2}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValidationError):
                self.evaluate(**kwargs)

    def test_monte_carlo_reproducible_and_valid_distribution(self):
        first = self.evaluate(seed=42, repeats=100)['monte_carlo']
        second = self.evaluate(list(reversed(evaluation_rows())), seed=42, repeats=100)['monte_carlo']
        self.assertEqual(first, second)
        self.assertEqual(first['seed'], 42)
        self.assertEqual(first['repeats'], 100)
        self.assertIn('NOT a confidence interval', first['interval_label'])
        # All possible k=1 burdens are 0, 1, 4; k=2 burdens are 1, 4, 5.
        self.assertEqual(set(first['results'][0]['burden_frequency']), {'0', '1', '4'})
        self.assertEqual(set(first['results'][1]['burden_frequency']), {'1', '4', '5'})
        for result in first['results']:
            self.assertEqual(sum(result['burden_frequency'].values()), 100)
        self.assertEqual(first['results'][2]['fn_burden_interval'], [5, 5])
        self.assertEqual(first['results'][2]['mean_fn_burden'], 5)

    def test_quantile_hand_expectation(self):
        self.assertEqual(matched.quantile([0, 10], 0.025), 0.25)
        self.assertEqual(matched.quantile([0, 10], 0.975), 9.75)
        self.assertEqual(matched.quantile([3], 0.975), 3)

    def test_evidence_label_required_and_restricted(self):
        self.write(matched.COLUMNS, evaluation_rows())
        with self.assertRaises(ValidationError):
            self.matched_evaluate(self.path, evidence_label='clinical')
        output = self.path.parent / 'reports'
        for extra in ([], ['--evidence-label', 'clinical']):
            result = self.cli('matched_review_evaluation.py', '--input', self.path, '--output', output, *extra)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(output.exists())

    def test_matched_cli_success_and_bad_budgets(self):
        self.write(matched.COLUMNS, evaluation_rows())
        output = self.path.parent / 'reports'
        arguments = ['--input', self.path, '--output', output, '--evidence-label', 'exploratory']
        result = self.cli('matched_review_evaluation.py', *arguments, '--budgets', '1,2', '--seed', '1', '--repeats', '10')
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads((output / 'report.json').read_text())
        self.assertEqual(report['budgets'], [1, 2])
        self.assertIn('임상 민감도가 아닙니다', (output / 'report.md').read_text())
        for value in ('', '1,', 'abc', '1.5', '0'):
            with self.subTest(value=value):
                result = self.cli('matched_review_evaluation.py', *arguments, '--budgets', value)
                self.assertEqual(result.returncode, 2)


def observation(participant='P001', role='team', task='1', elapsed=10, **overrides):
    row = dict(participant_pseudonym=participant, role=role, task_id=task, elapsed_seconds=elapsed,
               completed='true', GT_confusion='false', missing_means_safe='false', notes='')
    row.update(overrides)
    return row


class UsabilityTests(FixtureCase):
    def evaluate(self, rows):
        return self.usability_evaluate(self.write(usability.COLUMNS, rows))

    def test_shipped_template_is_not_collected(self):
        result = self.usability_evaluate(ROOT / 'usability_template.csv')
        self.assertEqual(result['status'], 'not_collected')
        self.assertEqual(result['participant_count'], 0)
        self.assertIsNone(result['metrics'])
        for role in usability.ROLES:
            self.assertEqual(result['by_role'][role]['participant_count'], 0)
            self.assertIsNone(result['by_role'][role]['metrics'])
        self.assertTrue(all(value is None for value in result['by_task'].values()))

    def test_all_blank_rows_are_not_participants(self):
        result = self.evaluate([dict.fromkeys(usability.COLUMNS, '')])
        self.assertEqual(result['ignored_blank_rows'], 1)
        self.assertEqual(result['status'], 'not_collected')

    def test_hand_expected_metrics_and_role_separation(self):
        result = self.evaluate([observation(task='1', elapsed=10),
                                observation(task='2', elapsed=20, completed='false', GT_confusion='true'),
                                observation('P002', 'lay', '1', 30, missing_means_safe='true'),
                                observation('P003', 'MD', '3', 40)])
        self.assertEqual(result['participant_count'], 3)
        self.assertEqual(result['metrics']['mean_elapsed_seconds'], 25)
        self.assertEqual(result['metrics']['completed_rate'], 0.75)
        self.assertEqual(result['metrics']['GT_confusion_rate'], 0.25)
        self.assertEqual(result['metrics']['missing_means_safe_rate'], 0.25)
        self.assertEqual(result['by_role']['team']['participant_count'], 1)
        self.assertEqual(result['by_role']['team']['metrics']['record_count'], 2)
        self.assertEqual(result['by_role']['team']['metrics']['completed_rate'], 0.5)
        self.assertEqual(result['by_task']['1']['mean_elapsed_seconds'], 20)
        self.assertEqual(result['participant_task_coverage'][0]['missing_record_task_ids'], ['3'])

    def test_no_md_evidence_and_no_notes_echo(self):
        result = self.evaluate([observation(notes='synthetic note not for report')])
        self.assertIsNone(result['by_role']['MD']['metrics'])
        self.assertNotIn('synthetic note', json.dumps(result))
        self.assertFalse(result['provenance']['automated_medical_understanding_scoring'])

    def test_invalid_schema_values(self):
        for overrides in ({'participant_pseudonym': ''}, {'role': 'doctor'}, {'task_id': '4'},
                          {'task_id': ''}, {'elapsed_seconds': ''}, {'elapsed_seconds': '-1'},
                          {'elapsed_seconds': 'NaN'}, {'elapsed_seconds': 'inf'}, {'elapsed_seconds': '1e999'},
                          {'completed': ''}, {'completed': '1'}, {'GT_confusion': 'yes'},
                          {'missing_means_safe': '0'}):
            with self.subTest(overrides=overrides), self.assertRaises(ValidationError):
                self.evaluate([observation(**overrides)])

    def test_duplicate_participant_task_and_inconsistent_role(self):
        for rows in ([observation(), observation()], [observation(), observation(role='MD', task='2')]):
            with self.subTest(rows=rows), self.assertRaises(ValidationError):
                self.evaluate(rows)

    def test_partial_rows_not_silently_dropped(self):
        row = dict.fromkeys(usability.COLUMNS, '')
        row['notes'] = 'unfinished synthetic entry'
        with self.assertRaises(ValidationError):
            self.evaluate([row])

    def test_missing_columns(self):
        with self.assertRaises(ValidationError):
            self.usability_evaluate(self.write(['participant_pseudonym'], []))

    def test_zero_elapsed_and_case_insensitive_bool(self):
        result = self.evaluate([observation(elapsed=0, completed='TRUE')])
        self.assertEqual(result['metrics']['mean_elapsed_seconds'], 0)
        self.assertEqual(result['metrics']['completed_count'], 1)

    def test_usability_cli_blank_template(self):
        output = self.path.parent / 'reports'
        result = self.cli('usability_records.py', '--input', ROOT / 'usability_template.csv', '--output', output)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((output / 'report.json').read_text())['status'], 'not_collected')
        self.assertIn('not_collected', (output / 'report.md').read_text())


class CSVContractTests(FixtureCase):
    def test_api_provenance_argv_reproduces_evaluation(self):
        for evaluate, columns, rows, options in (
                (self.ranking_evaluate, ranking.COLUMNS, [rank_row()], {}),
                (self.matched_evaluate, matched.COLUMNS, evaluation_rows(),
                 {'evidence_label': 'exploratory', 'budgets': [3, 1], 'seed': 9, 'repeats': 7}),
                (self.usability_evaluate, usability.COLUMNS, [], {})):
            with self.subTest(tool=evaluate.__name__):
                self.write(columns, rows)
                report = evaluate(self.path, **options)
                self.assertEqual(report['provenance']['argv_kind'], 'equivalent_cli_for_api_call')
                argv = report['provenance']['argv'].copy()
                output = self.path.parent / evaluate.__name__
                argv[argv.index('--output') + 1] = str(output)
                result = subprocess.run(argv, cwd=report['provenance']['cwd'], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                replay = json.loads((output / 'report.json').read_text())
                for value in (report, replay):
                    value['provenance'].pop('argv')
                    value['provenance'].pop('argv_kind')
                self.assertEqual(replay, report)

    def test_provenance_hashes_and_explicit_source(self):
        self.write(ranking.COLUMNS, [rank_row()])
        for kind in ('synthetic', 'local_structural', 'supplied_evaluation'):
            report = ranking.evaluate(self.path, source_kind=kind)
            source = report['provenance']
            self.assertEqual(source['source_kind'], kind)
            self.assertFalse(source['independent_split_verified'])
            self.assertFalse(source['source_kind_verified'])
            self.assertEqual(source['protocol_sha256'], hashlib.sha256((ROOT / 'protocol.md').read_bytes()).hexdigest())
            for name in ('toolkit_common.py', 'ranking_diagnostics.py', 'matched_review_evaluation.py', 'usability_records.py'):
                self.assertEqual(source['code_sha256'][name], hashlib.sha256((ROOT / name).read_bytes()).hexdigest())
        with self.assertRaises(ValidationError):
            ranking.evaluate(self.path, source_kind='unknown')
        with self.assertRaises(TypeError):
            ranking.evaluate(self.path)

    def test_source_kind_required_on_all_clis_and_replay(self):
        for script, columns, rows, extra in (
                ('ranking_diagnostics.py', ranking.COLUMNS, [rank_row()], []),
                ('matched_review_evaluation.py', matched.COLUMNS, evaluation_rows(), ['--evidence-label', 'exploratory', '--budgets', '1,3', '--seed', '7', '--repeats', '10']),
                ('usability_records.py', usability.COLUMNS, [], [])):
            with self.subTest(script=script):
                self.write(columns, rows)
                output = self.path.parent / script
                argv = [sys.executable, str(ROOT / script), '--input', str(self.path), '--output', str(output), *extra]
                for source_args in ([], ['--source-kind', 'unknown']):
                    result = subprocess.run([*argv, *source_args], cwd=ROOT, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 2)
                    self.assertFalse(output.exists())
                argv += ['--source-kind', 'synthetic']
                result = subprocess.run(argv, cwd=ROOT, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                first = json.loads((output / 'report.json').read_text())
                self.assertEqual(first['provenance']['argv'], argv)
                self.assertEqual(first['provenance']['argv_kind'], 'executed_cli')
                replay = subprocess.run(first['provenance']['argv'], cwd=first['provenance']['cwd'], capture_output=True, text=True)
                self.assertEqual(replay.returncode, 0, replay.stderr)
                self.assertEqual(json.loads((output / 'report.json').read_text()), first)

    def test_duplicate_headers_short_long_rows_and_invalid_encoding(self):
        for content in (b'case_id,case_id\nA,A\n',
                        ','.join(matched.COLUMNS).encode() + b'\nA,1,1\n',
                        ','.join(matched.COLUMNS).encode() + b'\nA,1,1,1,0,extra\n', b'\xff'):
            with self.subTest(content=content), self.assertRaises(ValidationError):
                self.path.write_bytes(content)
                self.matched_evaluate(self.path, evidence_label='exploratory')

    def test_utf8_bom_and_crlf_accepted(self):
        self.path.write_bytes(b'\xef\xbb\xbf' + ','.join(matched.COLUMNS).encode() + b'\r\nA,1,1,1,2\r\n')
        self.assertEqual(self.matched_evaluate(self.path, evidence_label='exploratory')['total_fn_burden'], 2)

    def test_validation_failure_creates_no_reports(self):
        for script, columns, rows, extra in (
                ('ranking_diagnostics.py', ranking.COLUMNS, [rank_row(volume=-1)], []),
                ('matched_review_evaluation.py', matched.COLUMNS, [], ['--evidence-label', 'exploratory']),
                ('usability_records.py', usability.COLUMNS, [observation(completed='')], [])):
            with self.subTest(script=script):
                self.write(columns, rows)
                output = self.path.parent / script
                result = self.cli(script, '--input', self.path, '--output', output, *extra)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(output.exists())
                self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main()
