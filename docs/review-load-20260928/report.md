# 검사당 추가 검토 후보 수 (탐색)

- 입력: `evidence.json` sha256 `89828f652a3edf0d...`
- 분모(후보 증거가 있는 검사 수): 38
- 결측(후보 증거 없음, 0으로 채우지 않음): 3 -> case_045, lv2-case_089, lv2-case_119
- 중복 제거 기준: `intersection/min(component voxels) >= 0.1` / 3D 연결성 26

| 검사 | 모델별 후보 수 | 중복 제거 후 고유 후보 | 추가(미짝) 후보 | 그중 작음 |
| --- | --- | --- | --- | --- |
| case_000 | baseline 9 / cappyv2 9 / cp050 10 | 10 | 1 | 1 |
| case_001 | baseline 13 / cappyv2 13 / cp050 13 | 13 | 1 | 1 |
| case_005 | baseline 2 / cappyv2 1 / cp050 1 | 2 | 1 | 1 |
| case_009 | baseline 7 / cappyv2 6 / cp050 7 | 7 | 0 | 0 |
| case_019 | baseline 3 / cappyv2 2 / cp050 3 | 3 | 0 | 0 |
| case_020 | baseline 5 / cappyv2 5 / cp050 7 | 8 | 4 | 4 |
| case_026 | baseline 5 / cappyv2 6 / cp050 6 | 6 | 0 | 0 |
| case_035 | baseline 7 / cappyv2 11 / cp050 16 | 17 | 10 | 6 |
| case_048 | baseline 2 / cappyv2 2 / cp050 3 | 3 | 1 | 1 |
| case_049 | baseline 22 / cappyv2 28 / cp050 24 | 29 | 3 | 2 |
| case_051 | baseline 8 / cappyv2 11 / cp050 8 | 10 | 2 | 2 |
| case_057 | baseline 2 / cappyv2 3 / cp050 4 | 4 | 1 | 1 |
| case_060 | baseline 1 / cappyv2 2 / cp050 2 | 2 | 0 | 0 |
| case_061 | baseline 2 / cappyv2 2 / cp050 3 | 3 | 1 | 1 |
| case_065 | baseline 1 / cappyv2 1 / cp050 1 | 1 | 0 | 0 |
| case_079 | baseline 10 / cappyv2 10 / cp050 9 | 10 | 0 | 0 |
| case_080 | baseline 2 / cappyv2 2 / cp050 2 | 2 | 0 | 0 |
| case_083 | baseline 2 / cappyv2 2 / cp050 2 | 2 | 0 | 0 |
| case_088 | baseline 4 / cappyv2 9 / cp050 8 | 11 | 6 | 6 |
| case_093 | baseline 29 / cappyv2 30 / cp050 30 | 35 | 7 | 7 |
| case_095 | baseline 4 / cappyv2 8 / cp050 8 | 12 | 8 | 8 |
| case_102 | baseline 1 / cappyv2 1 / cp050 1 | 1 | 0 | 0 |
| case_113 | baseline 14 / cappyv2 15 / cp050 12 | 15 | 2 | 2 |
| case_116 | baseline 0 / cappyv2 0 / cp050 2 | 2 | 2 | 1 |
| case_126 | baseline 2 / cappyv2 2 / cp050 2 | 2 | 0 | 0 |
| case_129 | baseline 12 / cappyv2 13 / cp050 12 | 12 | 0 | 0 |
| lv2-case_041 | baseline 4 / cappyv2 5 | 5 | 1 | 1 |
| lv2-case_114 | baseline 1 / cappyv2 0 | 1 | 1 | 0 |
| lv2-case_115 | baseline 1 / cappyv2 3 | 3 | 2 | 1 |
| lv2-case_117 | baseline 52 / cappyv2 53 | 55 | 10 | 10 |
| lv2-case_118 | baseline 10 / cappyv2 9 | 10 | 1 | 1 |
| lv2-case_120 | baseline 5 / cappyv2 4 | 5 | 1 | 0 |
| lv2-case_121 | baseline 3 / cappyv2 4 | 5 | 3 | 2 |
| lv2-case_122 | baseline 10 / cappyv2 9 | 11 | 3 | 3 |
| lv2-case_123 | baseline 9 / cappyv2 9 | 8 | 0 | 0 |
| lv2-case_125 | baseline 1 / cappyv2 1 | 1 | 0 | 0 |
| lv2-case_127 | baseline 0 / cappyv2 1 | 1 | 1 | 0 |
| lv2-case_128 | baseline 14 / cappyv2 14 | 12 | 1 | 1 |

- 고유 후보: 분자 339 / 분모 38 = 평균 8.9211 (정확값 339/38), 중간값 5.5, 최소 1, 최대 55, Q1 2.0, Q3 11.0
- 추가 후보: 분자 74 / 분모 38 = 평균 1.9474 (정확값 37/19), 중간값 1.0, 최소 0, 최대 10, Q1 0.0, Q3 2.0
- 추가 후보 중 작음: 분자 63 / 분모 38 = 평균 1.6579 (정확값 63/38), 중간값 1.0, 최소 0, 최대 10, Q1 0.0, Q3 2.0
- 참고 단일 모델 최다 후보: 분자 326 / 분모 38, 중간값 5.5, 최대 53

탐색 전용. 임상 민감도·업무시간 절감·임상 유효성 주장에 쓰지 않는다.
