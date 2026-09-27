"""Standard-library CSV validation and reproducible report helpers."""

import csv
import hashlib
import io
import json
import math
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path


class ValidationError(ValueError):
    """Invalid input contract."""


def read_csv(path, required):
    raw = Path(path).read_bytes()
    try:
        reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')), strict=True)
        fields = reader.fieldnames
        if not fields or len(fields) != len(set(fields)):
            raise ValidationError('Missing or duplicate CSV header')
        missing = set(required) - set(fields)
        if missing:
            raise ValidationError('Missing columns: ' + ', '.join(sorted(missing)))
        rows = []
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValidationError(f'Malformed CSV row at line {reader.line_num}')
            rows.append({key: value.strip() for key, value in row.items()})
    except (UnicodeError, csv.Error) as exc:
        raise ValidationError(f'Invalid UTF-8 CSV: {exc}') from exc
    return rows, hashlib.sha256(raw).hexdigest()


def number(value, field, *, integer=False, positive=False, optional=False):
    if value == '' and optional:
        return None
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise ValidationError(f'{field}: required finite number') from exc
    if not parsed.is_finite() or parsed < 0 or (positive and parsed == 0):
        raise ValidationError(f'{field}: required finite {"positive" if positive else "nonnegative"} number')
    # Bound all numeric inputs before conversion, including large integral exponents.
    if not math.isfinite(float(parsed)):
        raise ValidationError(f'{field}: number outside supported finite range')
    if integer:
        if parsed != parsed.to_integral_value():
            raise ValidationError(f'{field}: required integer')
        return int(parsed)
    # Decimal preserves exact input comparisons.
    return parsed


def unique_ids(rows, field='case_id'):
    seen = set()
    for row in rows:
        value = row[field]
        if not value or value in seen:
            raise ValidationError(f'{field}: blank or duplicate identifier {value!r}')
        seen.add(value)


def write_reports(output, report, markdown):
    directory = Path(output)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    source = report['provenance']
    markdown += (f"\n출처 유형(사용자 선언): {source['source_kind']}\n\n"
                 f"프로토콜 SHA-256: {source['protocol_sha256']}\n\n"
                 '코드 해시, 실행 argv, cwd, Python 버전은 report.json의 provenance에 있습니다.\n')
    (directory / 'report.md').write_text(markdown, encoding='utf-8')


SOURCE_KINDS = ('synthetic', 'local_structural', 'supplied_evaluation')


def provenance(digest, *, source_kind, script, input_path, options=()):
    if source_kind not in SOURCE_KINDS:
        raise ValidationError('source_kind must be synthetic/local_structural/supplied_evaluation')
    root = Path(__file__).resolve().parent
    code_files = ('toolkit_common.py', 'ranking_diagnostics.py',
                  'matched_review_evaluation.py', 'usability_records.py')
    return {'input_sha256': digest, 'evidence_label': 'exploratory',
            'source_kind': source_kind, 'source_kind_verified': False,
            'code_sha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
                            for name in code_files},
            'protocol_sha256': hashlib.sha256((root / 'protocol.md').read_bytes()).hexdigest(),
            'argv': [sys.executable, str(root / script), '--input', str(Path(input_path).resolve()),
                     '--output', str(Path('replay_reports', Path(script).stem).resolve()),
                     '--source-kind', source_kind, *options],
            'argv_kind': 'equivalent_cli_for_api_call', 'cwd': str(Path.cwd()),
            'python_version': sys.version,
            'independent_split_verified': False,
            'clinical_utility_claim': False}


def record_cli_argv(report, script):
    report['provenance']['argv'] = [sys.executable, str(Path(script).resolve()), *sys.argv[1:]]
    report['provenance']['argv_kind'] = 'executed_cli'
