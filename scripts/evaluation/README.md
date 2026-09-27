# P1 평가 도구 사용법

Python 3 표준 라이브러리만 사용합니다. 먼저 [프로토콜](protocol.md)을 읽으세요. 모든 도구는 로컬 CSV를 읽고 --output **폴더** 안에 report.json과 report.md를 씁니다. 같은 출력 폴더를 재사용하면 기존 보고서를 덮어쓰므로 도구별 폴더를 사용하세요. 검증 실패는 종료 코드 2이며 새 보고서를 쓰지 않습니다. 이전 보고서가 있는 폴더에서는 오래된 결과를 혼동하지 마세요.

모든 CLI에 --source-kind가 필수입니다: synthetic(합성 입력), local_structural(실제 로컬 구조 진단), supplied_evaluation(제공된 평가 라벨/수동 관찰 기록). 입력 출처에 맞게 직접 선택하세요. API도 source_kind를 명시해야 합니다. 이 값은 사용자 선언이고 자동 검증하지 않습니다. JSON provenance는 입력·코드 4개 파일·protocol.md의 SHA-256, 재현 argv 배열/cwd/Python 버전을 포함합니다. CLI는 실제 인수를 기록하고 API는 동일 평가용 CLI 명령을 기록합니다. 기록한 입력/코드/프로토콜/환경을 보존해야 재현할 수 있습니다. 독립 분할 검증은 항상 false입니다.

## 순위 구조

필수 헤더:

```csv
case_id,review_group,largest_component_ml,component_count,maximum_3d_diameter_mm,sphericity,glcm_joint_entropy_bin25,absolute_tumor_liver_contrast_hu,review_group_bin50,clinical_urgency,sample_stratum,interpretation
```

display_order는 선택 열이며 있으면 양의 정수 또는 빈 값입니다. 측정값·그룹·결측 계약은 protocol.md에 정의되어 있습니다. 부피/개수가 양수인 완전한 행에는 원본 4축 그룹이 필요합니다. 그룹은 재계산과 다르면 실패합니다. 사례 ID는 공백을 제거한 문자열로 비교하며 문자열 오름차순입니다(예: C10이 C2보다 앞). 부피/개수 0 + 빈 그룹은 주석 없음이며, 빈 측정값은 unknown입니다. unknown과 주석 없음의 제외 개수 및 ID는 JSON에 명시됩니다. 순위 코호트가 0인 경우 그룹 비율은 null이며, CSV 자체에 사례 행이 하나도 없으면 실패합니다.

```bash
python3 ranking_diagnostics.py --input ranking.csv --output outputs/ranking --source-kind local_structural
```

큰 부피/ID 기준선은 같은 완전한 코호트에만 적용합니다. Pareto 그룹 안에서는 ID 순서이며 가중치가 없습니다. review_group_bin50 누락은 별도 표시하며 비교 분모에 들어가지 않습니다. bin50 원본 그룹 비교는 bin50 특징을 재계산한 안정성 평가가 아닙니다. clinical_urgency 등 자유 텍스트는 해석·점수화하지 않습니다. 입력 파일의 정확한 바이트에 대한 SHA-256을 남깁니다. 출력에 사례 ID가 포함되므로 실제 자료 통합 시 비식별 ID를 사용하세요.

sphericity는 정확히 [0,1] 범위만 허용합니다. 근거 있는 오차 계약이 없으므로 허용오차·클리핑은 없습니다. 범위를 벗어난 실제 측정값을 수정하지 않고 검증 오류로 보고합니다. 실제 구조 CSV에 대한 후향적 기술 비교는 허용되지만 임상 효용 검증은 아닙니다. 부모가 보고한 real24의 주석 있는 20행/주석 없음 4행 비교도 기술적 결과에 한정되며 이 worker가 재검증한 결과가 아닙니다.

## 동일 코호트 FN 부담

별도 평가 CSV의 필수 헤더:

```csv
case_id,candidate_rank,largest_component_ml,disagreement_score,fn_count
```

candidate_rank는 동일 행 집합의 정확한 1..N 순열입니다. largest_component_ml 및 disagreement_score는 실제 측정한 유한 비음수 값이 필수입니다. 두 기준선은 각 측정값 내림차순, 동률 시 case_id 오름차순으로 계산합니다. 선택 열 volume_rank/disagreement_rank가 있으면 계산 순위와 반드시 일치해야 하며 빈 값·역순·임의 순열은 거부합니다. JSON rank_queues에서 실제 비교 순서를 확인할 수 있습니다. 불일치 점수의 생성 방법·단위는 공급자가 프로젝트 계약에 따라 별도로 기록하세요.

fn_count는 프로젝트 지표 계약에 따라 **독립적으로 계산한** 유한 비음수 정수입니다. 부피·불일치 점수 등 순위 특징에서 라벨을 만들지 마세요. 누락 측정값·후보 순위·FN 라벨은 오류이며 0으로 채우지 않습니다. 후보의 동률 그룹을 순열로 만드는 규칙은 사전에 고정하고 기록해야 합니다.

```bash
python3 matched_review_evaluation.py --input evaluation.csv --output outputs/matched --source-kind supplied_evaluation --evidence-label exploratory --budgets 1,2
python3 matched_review_evaluation.py --input evaluation.csv --output outputs/matched_mc --source-kind supplied_evaluation --evidence-label exploratory --seed 42 --repeats 1000
```

--budgets 생략 시 k=1..N 전부 계산합니다. k는 중복 없는 1..N 정수입니다. --seed와 --repeats는 함께 제공해야 합니다. 균등 무작위 기대 부담은 시뮬레이션 없이 k/N × 총 FN으로 계산합니다. JSON에는 부동소수점 값과 정확한 분자/분모를 함께 남깁니다. 선택적 시뮬레이션은 seed와 반복 횟수, 경험 빈도 및 Monte Carlo 백분위 구간을 남깁니다. 이 구간은 신뢰구간이 아닙니다. 총 FN=0이면 부담은 0이고 모든 포착 비율은 null입니다. 결과는 임상 민감도가 아닙니다. 독립 분할·라벨 생성·지표 계약 준수는 검증하지 않습니다.

## 사용성 및 테스트

[TASKS.md](TASKS.md)와 빈 [usability_template.csv](usability_template.csv)를 사용합니다. 자동 의학 이해 채점은 없습니다. 실제 MD 평가를 했다고 추론하지 마세요.

```bash
python3 -m unittest discover -s tests -v
```

테스트는 작업공간 안의 임시 합성 CSV만 사용하고 정리합니다. 실제 의료 데이터·실제 사용자 평가가 아닙니다. 순위 구현은 작은/중간 코호트 진단용이며 반복 Pareto 층 추출은 최악 O(N³) 비교입니다. 대규모 입력의 실행 시간 검증은 별도 필요합니다.
