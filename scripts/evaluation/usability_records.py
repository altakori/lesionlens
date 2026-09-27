"""Summarize manually populated, pseudonymous usability observations only."""

import argparse

from toolkit_common import SOURCE_KINDS, record_cli_argv, ValidationError, number, provenance, read_csv, write_reports

COLUMNS = ('participant_pseudonym', 'role', 'task_id', 'elapsed_seconds', 'completed',
           'GT_confusion', 'missing_means_safe', 'notes')
ROLES = ('team', 'lay', 'MD')
TASKS = ('1', '2', '3')
BOOL_FIELDS = ('completed', 'GT_confusion', 'missing_means_safe')


def metrics(rows):
    if not rows:
        return None
    return {'record_count': len(rows),
            'mean_elapsed_seconds': float(sum(row['elapsed_seconds'] for row in rows) / len(rows)),
            **{field + '_count': sum(row[field] for row in rows) for field in BOOL_FIELDS},
            **{field + '_rate': sum(row[field] for row in rows) / len(rows) for field in BOOL_FIELDS}}


def evaluate(path, *, source_kind):
    raw_rows, digest = read_csv(path, COLUMNS)
    rows, seen, participant_roles = [], set(), {}
    blank_count = 0
    for row in raw_rows:
        if not any(row.values()):
            blank_count += 1
            continue
        participant = row['participant_pseudonym']
        if not participant:
            raise ValidationError('participant_pseudonym is required for populated rows')
        if row['role'] not in ROLES or row['task_id'] not in TASKS:
            raise ValidationError('role must be team/lay/MD and task_id must be 1/2/3')
        if participant in participant_roles and participant_roles[participant] != row['role']:
            raise ValidationError('A participant must have one consistent role')
        participant_roles[participant] = row['role']
        pair = (participant, row['task_id'])
        if pair in seen:
            raise ValidationError('Duplicate participant-task record')
        seen.add(pair)
        row['elapsed_seconds'] = number(row['elapsed_seconds'], 'elapsed_seconds')
        for field in BOOL_FIELDS:
            if row[field].lower() not in ('true', 'false'):
                raise ValidationError(f'{field}: required true or false')
            row[field] = row[field].lower() == 'true'
        rows.append(row)
    source = provenance(digest, source_kind=source_kind, script='usability_records.py', input_path=path)
    source.update({'collection': 'manual_records', 'record_authenticity_verified': False,
                   'automated_medical_understanding_scoring': False})
    return {'provenance': source, 'status': 'collected' if rows else 'not_collected',
            'participant_count': len(participant_roles), 'record_count': len(rows),
            'ignored_blank_rows': blank_count, 'metrics': metrics(rows),
            'by_role': {role: {'participant_count': sum(r == role for r in participant_roles.values()),
                               'metrics': metrics([row for row in rows if row['role'] == role]),
                               'by_task': {task: metrics([row for row in rows if row['role'] == role
                                                          and row['task_id'] == task]) for task in TASKS}}
                        for role in ROLES},
            'by_task': {task: metrics([row for row in rows if row['task_id'] == task]) for task in TASKS},
            'participant_task_coverage': [{'participant_pseudonym': p, 'role': participant_roles[p],
                                           'recorded_task_ids': sorted(task for person, task in seen if person == p),
                                           'missing_record_task_ids': sorted(set(TASKS) - {task for person, task in seen if person == p})}
                                          for p in sorted(participant_roles)]}


def markdown(report):
    lines = ['# 수동 사용성 기록 요약', '',
             f"상태: {report['status']}; 참여자: {report['participant_count']}; 기록: {report['record_count']}",
             '수동 관찰값만 요약하며 의학적 이해를 자동 채점하지 않습니다. 기록 진위를 검증하지 않습니다.',
             '빈 역할·과제의 지표는 null입니다. 역할별 기록을 임상 근거로 해석하지 마세요.', '',
             f"전체 지표: {report['metrics']}"]
    for role, data in report['by_role'].items():
        lines.append(f"- {role}: 참여자 {data['participant_count']}; 지표 {data['metrics']}")
    lines += ['', '과제별 분모·누락 과제는 report.json에 있습니다. 누락 과제를 실패/성공으로 채우지 않습니다.',
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
