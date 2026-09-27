# lv2-test20 코호트 (labv2 Dataset003_Liver fold_0 test set)

> 수신 20건 → 앱 편입 14건. 제외 근거는 아래 두 절(GT affine 가드 2건, 기존 코호트와 CT 바이트 동일 4건).

최종 갱신: 2026-09-27(새벽 3차 확장). matched-r3 코호트(27건)에 이은 **두 번째 실행군**이다.
이 문서도 성능·임상 효과 주장이 아니라 **출처·무결성·제외 사유·범위**만 다룬다.

## 왜 받았나
발표 전에 "앱 사례는 어디까지가 실제 산출물인가"에 대한 답이 27건으로 고정되어 있었다.
ai0를 전수 인벤토리한 결과 원본 CT·정답 라벨·**서로 다른 두 트레이너의 예측**이 함께 있는
held-out 20건 test set가 남아 있었고(아래 표), 이건 비교 큐의 근거 사례로 쓸 수 있었다.

## 출처 (읽기 전용, 승인된 별명 capp_ai0만 사용)
- 사례 집합: Dataset003_Liver `imagesTs` 20건(case_041, case_089, case_113~case_130), GT는 같은 경로의 `labelsTs`.
- 원본 CT: `~/labv2/cappy_v2/nnUNet_raw/Dataset003_Liver/imagesTs/case_*_0000.nii.gz`
- GT: `~/labv2/cappy_v2/nnUNet_raw/Dataset003_Liver/labelsTs/case_*.nii.gz`
- 예측 arm 1(기본 AI): `~/labv2/baseline/nnUNet_results/Dataset003_Liver/inference_fold0_best/case_*.nii.gz`
- 예측 arm 2(CAPPYv2): `~/labv2/cappy_v2/nnUNet_results/Dataset003_Liver/inference_fold0_best/case_*.nii.gz`
- 실행 인자: 각 dir의 `predict_from_raw_data_args.json`(baseline은 `.../baseline/.../imagesTs`를 지정), `summary.json`.
- 클래스 정의(`dataset.json`): background 0, liver 1, **lesion 2**, numTraining 196.
  앱이 그리는 마스크는 `prepare_model_compare.canonical_arrays()`가 **class 2만** 추출한 병변 표시다.
- 두 모델의 학습 자료와 test 20건은 겹치지 않는다. `imagesTr`/`imagesTs` 파일명에서
  `_0000.nii.gz`를 벗긴 ID 집합으로 대조했다(2026-09-27 재확인).
  - baseline: train 111건(case_000~case_112) · test 23건 · train∩test = 0
  - cappy_v2: train 196건(case_000~case_215 중 196) · test 20건 · train∩test = 0
  - test 20건(case_041, 089, 113~130)은 두 트레이너 train ID 집합에 **모두 없음** → held-out.
  (처음 확인에서는 파일명 치환 실수로 매치가 성립하지 않아 0건이 나왔고, 위 방식으로 다시 확인했다.)
- 파일명은 `case_XXX_0000.nii.gz` 하나로 **환자·검사·날짜 키가 없다**. 그래서 이 데이터셋에서는
  같은 환자의 이전·다음 검사를 만들 근거가 없고, GT 모양 유사성으로 추정하면 그건 가정이다.
- run이 자체 보고한 class 2(Dataset003 = LiTS 계열) 평균: baseline Dice 0.4872(FN 113,276 FP 26,785),
  CAPPYv2 Dice 0.5494(FN 107,130 FP 30,330). 이건 **해당 실행의 자체 요약**이고 이 프로젝트의 성능 주장이 아니다.

## 무결성 확인 (관측 사실)
- 다운로드 전에 원격에서 `sha256sum`을 받아 두었다가(`work/lv2-hash.out`, `work/lv2-mask-sha.txt` 82건)
  수신 파일에 대해 로컬 재계산 → **CT 20/20, 마스크 62/62 일치**.
- tar 스트리밍 바이트 수가 원격 `tar | wc -c`와 동일(CT 3,319,664,640 / 마스크 17,203,200).
- 스테이징은 CT를 기준으로 shape·affine **완전 일치**를 요구한다. 20건 중 18건 `geom_agree: true`
  (`work/lv2/stage20_report.json`), 스테이징된 보셀 수는 registry의 `voxels2`로 고정되고
  빌드가 자산을 재생성할 때마다 재계산·비교된다.

## 제외 2건: lv2-case_124, lv2-case_130
LiTS 계열 라벨의 float32 저장 반올림으로 **GT affine만** CT와 완전히 같지 않다.
- case_124: shape 일치, affine 최대차 `5.96e-08`
- case_130: shape 일치, affine 최대차 `5.72e-06` (GT 1,383,692 vs 모델 347,465/326,475 보셀 → 제외된 이유 아쉽게 보이는 사례)

`canonical_arrays()`는 CT·GT·모델 affine **완전 일치**를 요구하므로 거부된다. case_086과 같은 규칙이고,
가드를 완화하지 않았다(완화하면 z축 정렬 보장을 잃는다). 후보 처리: GT 헤더만 CT 값으로 재표현(출처 명시) 또는
`allclose(atol=1e-6)` 완화 + 회귀 테스트. 둘 다 발표 동결 이후 결정.

## 제외 4건: imageSha256가 기존 코호트와 같은 사례
case_113·116·126·129는 **CT 파일이 바이트 단위로 동일**했다. LiTS(Task009)와 Dataset003가
다른 번호 체계로 같은 영상을 재포장한 것으로 보인다(두 집합의 GT 보셀 수도 같다).
한 영상으로 두 개의 카드를 만들면 중복 후보가 되므로 편입하지 않았다.

| lv2 사례 | imageSha256 앞 12자리 | 기존 코호트에서 동일한 사례 |
|---|---|---|
| lv2-case_113 | `ac40b396f205` | case_113 |
| lv2-case_116 | `626c8b1acc27` | case_116 |
| lv2-case_126 | `2d5f0c8dfcf6` | case_126 |
| lv2-case_129 | `cf0947b31763` | case_129 |

→ 20건 − affine 가드 2건 − 중복 4건 = **14건 편입**(`lv2-case_041, 089, 114, 115, 117, 118, 119, 120, 121, 122, 123, 125, 127, 128`).

## 이 코호트의 다른 점 3가지(발표에서 같이 말해야 한다)
1. **AI 2종뿐이다.** cp050은 Task009_Liver 실행군이어서 이 사례들에 예측이 없다. 큐 카드의
   이유 줄 끝에 `· AI 비교 2/3종`이 붙고, 펼치면 모델 표에서 cp050 자리가 `자료 없음`으로 표시된다.
   불일치 점수는 실제 존재하는 2종만으로 계산된다.
2. **사례 번호가 겹친다.** LiTS(Task009)와 Dataset003는 다른 데이터셋인데 같은 번호를 쓴다.
   앱 ID는 `lv2-case_114`처럼 접두어를 붙여 구분한다(같은 번호의 기존 카드와 화면에 함께 뜬다).
3. **정렬·그룹은 코호트 혼합 상태에서 계산된다.** burden 그룹과 GT 부피 정렬은 41건 전체에서
   다시 계산되므로 "1순위"는 한 코호트의 순위가 아니다.

## ai0에 있지만 넣지 않은 것 (전수 인벤토리)
| 자료 | 예측 arm | 사정 |
|---|---|---|
| `research_runs/v2_matched_inference_20260916/full_r3/arms/*` | 4종 27건 | 이미 v3에서 전부 사용(앱에서 26건 + case_086 제외) |
| `next_experiments/cp050_e1000_20260725/test27_runs/*` | cp050 27건 | 위와 같은 27건(arm 하나만 추가) |
| `oof_cp050_fold0/fold1_pilot_*/.../fold_{0,1}/validation_raw` | **cp050 홀로 35+35건** | OOF라 단일 arm. 모델 간 불일치를 계산할 상대가 없어 큐의 핵심 비교가 성립하지 않는다 |
| `cp050_cooldown_e850_*`, `cp050_cpoff_e1000_*`(val 9건) | cp050 계열 체크포인트별 단일 arm | 체크포인트끼리의 비교는 가능하지만 앱이 모델 3개 슬롯 고정이라 새 모델 정체를 UI에 추가해야 한다 |
| `labv2/*/nnUNet_preprocessed/*/gt_segmentations`(131·196건) | 예측 아님 | 라벨뿐이라 비교 대상이 없다 |
| 3D-IRCADb-01(환자당 동맥·정맥 2검사 20명) | — | 환자 시리즈의 실제 근거이지만 `external_data_quarantine` 격리, CC BY-NC-ND 재배포 금지, DICOM PatientName·BirthDate 포함 → 비식별·사용조건 결정 전 사용 불가 |

결론: **네 모델 arm이 모두 있는 집합은 27건이 전부**이고, 여기에 held-out 2종 arm 신규 CT 14건을 더해 지금 41건이다(27 + 14).

## 앱에 미치는 영향
- 큐 카드 41건(+ 합성 DEMO 1건). 절편 20,142장(matched-r3 12,055 + lv2 8,087), 자산 92,401개, 매니페스트 15,780,282바이트(15.0MB).
- lv2 카드는 이유 줄 끝에 `· AI 비교 2/3종`이 붙는다(case_045는 기존대로 `비교 가능한 모델 2종 미만`).
- `md-core.js` 검사 receipt 44건(사례 41 + LL-CT 3). imageSha256 기준 중복 판정은
  case_000↔LL-CT-001, case_045↔LL-CT-003 두 쌍만 의도된 것이고, lv2 신규 14건은 모두 고유 영상이다.
- localStorage 키가 `MANIFEST_VERSION`이라 v4에서 발표자의 `검토 완료` 표시는 초기화된다(시연 전 기준).

## 검증 (2026-09-27, 빌드 후 실측)
- `prepare_model_compare.py --evidence` 종료코드 0, stdout
  `{"version": "lits-model-compare-v4", "cases": 41, "slices": 20142, "sourceBound": true}`.
- 디스크 자산 92,401개 = 매니페스트가 요구하는 자산 수와 정확히 일치(webp/png 파일 실재).
- **불변성**: `work/manifest_v3_before.json`과 v4를 절편 단위로 대조 → 기존 27건의
  절편 12,055개에서 CT·오버레이 sha256 변경 0건, 사례 통계(gt/models/disagreement) 변경 0건.
- 스키마: `validate_manifest()` 반환 자산 92,401개(`tests/test_compare_server.py` 기대값), lv2에는 cp050 주입 거부.
- 브라우저(정적 서버 4175, Edge headless): 카드 42개(41+DEMO), pageerror 0,
  320/390/768/1440px 가로넘침 0, lv2-case_117 CT 확대 시 캔버스 렌더 확인 + 자산 요청 4건 전부 2xx.
- 회귀: `tests/app.test.js` 28 pass, `tests/md-send.test.js` 22 pass,
  `tests/browser_md_send.py`·`browser_md_viewpoint.py` PASS(fixture를 `compare_manifest` 기반으로 재작성).
