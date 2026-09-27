# 검사 시리즈 표시와 중복 제거 (2026-09-27)

## 요청
- ai0·capp에 있는 시리즈(같은 환자의 이전·다음 검사) 자료를 더 찾고, 같은 시리즈에 속하는 검사가 화면에 중복해서 뜨지 않게 한다.

## 조사 근거 (읽기 전용)
- ai0(`capp_ai0`, 호스트 gpuserver): nii/nii.gz/mha/nrrd 4,711개. 전부 nnUNet 학습 트리의 image·label 쌍(Task003_Liver / Task009_Liver / Dataset003_Liver, PreprocessedNoMatter)이며 검사 단위가 아니라 전처리 산출물이다. 실 patient DICOM은 0건(`*.dcm` 21건은 모두 nibabel 테스트 픽스처). `follow-up`·`longitudinal`을 언급한 자료 문서도 없음.
- ai0의 유일한 다중 검사 자료: `~/Cappyv2/external_data_quarantine/3d_ircadb_01` (3D-IRCADb-01, 환자 20명 × 동맥·정맥 2검사). 사용 유보 사유는 그 폴더의 README_STATUS.md 원문대로 ① "No model inference has been authorized" ② "Do not redistribute raw or converted data; official page states CC BY-NC-ND 4.0" ③ "Privacy review required … populated DICOM identity-related tags" + STRUCTURAL_ANALYSIS.json의 sensitive_tag_populated_case_counts(PatientName 20, PatientBirthDate 20, InstitutionName 20).
- `capp` 별명은 두 번 모두 "Connection closed by UNKNOWN port 65535"로 접속 실패 → 조사 불가.
- 로컬 표시 자산 32건: CT 슬라이드 sha256가 겹치는 쌍은 `model_compare`와 `capp_cases`의 같은 id(case_000 75매, case_001 123매, case_045 74매)뿐이고, `real_cases`의 LL-CT-001·LL-CT-003은 case_000·case_045와 volume 해시가 같다. GT(비어 있지 않은 mask 슬라이드) 해시 겹침은 0건 → 서로 다른 검사. voxel shape/spacing만 겹치는 case_035·case_046은 1.0mm 재격자 때문이고 GT 겹침이 없어 같은 환자가 아니다.
- Dataset003_Liver(=LiTS)는 환자당 CT 1건에 환자 키를 주지 않는다. 따라서 로컬 자산에는 실제 이전·다음 검사가 존재하지 않는다.

## 결정
- 획득 지표로 환자를 지어내던 `seriesGroups`(DEMO-P-01)와 가정 촬영일을 삭제했다. 검사 식별은 자산 옆에 이미 있던 image sha256 receipt만 쓴다.
- 카드는 image sha256가 같은 별칭을 두 개로 내보내지 않는다(`queue()`의 `studyIdentityKey` 가드). receipt가 없는 자산은 신원을 모른다(`unknown:<id>`)고 보고 어떤 그룹에도 넣지 않는다.
- 같은 검사의 다른 별칭(LL-CT-001, LL-CT-003)은 "이전 CT"가 아니라 복제 표시 한 줄 텍스트로만 보이고, 두 번째 뷰어를 마운트하지 않는다. 전송 모달과 수신 화면도 같은 문구를 쓴다.
- 표시할 검사가 없으면 실패 문구("이 서버가 제공하는 자산 목록에 이 검사가 없습니다")가 그대로 남는 fail-closed를 유지한다.

## 검증
- `node --check` 3개 통과, `node --test tests/*.test.js` 75/75 (시리즈·priorStudy 테스트를 새 계약으로 교체하고 큐 중복 제거 테스트 추가).
- `LESIONLENS_BASE_URL=http://127.0.0.1:4175`에서 `browser_md_feedback.py` 통과(시리즈 바에 복제 표시 텍스트, 칩 0개, 시리즈 뷰어 canvas 0개, 빈 박스 금지), send·viewpoint·scroll 3종 통과. `pytest`(데이터 준비 테스트 제외) 41 passed / 22 skipped.
- 기하: 카드 6개 중 복제가 있는 2개의 시리즈 바 83px, 나머지 59px, 칩 0개, 시리즈 뷰어 canvas 0개. 320/390/768/1440px 가로 넘침 0.

## 한계
- 실제 환자 시리즈 표시·경과 비교는 환자 식별키와 촬영일이 있는 자료(병원 PACS 또는 비식별화된 다중 검사 자료)가 확보되어야 구현·검증 대상이 된다. 지금은 "이 검사 1건 · 이전·다음 검사 미확인"만 표시한다.
- IRCADb를 쓰려면 사용조건·비식별 결정이 먼저이고, 그 결정 전에는 원시·변환 데이터 모두 반출하지 않는다.
## 뒤이은 배치 수정 (같은 날, 사용자 화면 피드백)
- 지적: 카드마다 항상 뜨는 시리즈 바가 헷갈리고 카드가 길다. request = 시리즈를 환자 카드 안의 토글로 넣고, CT 확대·AI 소견을 펼쳤을 때 보이게 한다.
- 적용: 접힌 카드에서는 시리즈 영역이 보이지 않게 한다(`seriesBox.hidden=true`, 펼침 카드 109px → 기존 198/222px에서 축소). `CT 확대`를 누르면 CT 뷰 아래에 `검사 시리즈 · 1건 · 이전·다음 없음` 토글(34px)이 생기고, 눌러야 근거·복제 표시·검사 카드가 펼쳐진다(83px). `AI 소견·Radiomics`를 펼치면 같은 내용이 문장 한 줄(42px)로 반복되고 두 번째 뷰어는 마운트하지 않는다.
- 검증: 접힌 카드에 보이는 시리즈 영역 0개, 펼친 카드 1개, chip 0개, 시리즈 뷰어 canvas 0개, 320/390/768/1440px 가로 넘침 0. `browser_md_feedback.py`에 "접힘 → 토글 클릭 → 표시" 순서를 명시적으로 assert했다.
- 단, case_000·case_001은 시리즈가 아니다. 위 sha256 대조에서 다른 검사로 확인됐고 GT mask 겹침도 0건이므로, 토글 안의 "이전 CT" 카드는 실제 이전 검사가 있는 자료가 들어올 때만 채운다. 지금은 토글이 "이전·다음 없음" 상태로 열린다.
## 뒤이은 전수 확인 (같은 날 오후, "널널한 기준으로도 시리즈 후보가 있나")

### 요청
- 트레이닝셋(Dataset003_Liver 216건)에서 GT를 보고, 기준을 널널하게 잡아서라도 이전·다음 검사로 쓸 만한 쌍이 있는지 확인한다.

### 방법 (읽기 전용, capp_ai0)
- `imagesTr`+`imagesTs` 216건의 NIfTI 헤더(shape, spacing, srow_x/y/z, scl_slope, scl_inter)와 파일 sha256을 전부 읽었다.
- 지오메트리(shape+spacing+origin+방향행렬)가 같은 그룹을 만든 뒤, 그룹 안에서 ① 파일 바이트 ② 각 파일의 scl_slope/scl_inter를 적용한 HU ③ GT 라벨을 비교했다. 판정은 최대 30장 슬라이스·2배 다운샘플 볼륨에서 각 볼륨 아래 1%를 제외한 공통 복셀로 B = a·A + b 선형적합을 하고, 잔차 평균(HU)으로 "같은 영상" 여부를 갈랐다.
- GT 라벨 부호는 nibabel로 다시 읽어 확정했다.

### 사실
- 216건은 **서로 다른 검사 131건 + 같은 검사의 재스케일 복사본 85건**이다. 지오메트리 그룹은 129개(2명 이상 83개, 단일 46개)이고, 4개짜리 2개 그룹만 서로 다른 검사를 2개씩 담았다.
- 같은 검사로 판정된 85쌍: corr >= 0.99979, 적합 기울기 >= 0.9994, 절편 ~0, **잔차 평균 0.000~0.520 HU**, body mask IoU 1.000. 두 파일의 실질적 차이는 헤더의 `scl_slope`/`scl_inter`뿐이다(예: case_000 slope 1.0 / inter -1024 <-> case_131 slope 0.0677 / inter -807).
- 4개짜리 그룹 {case_035, case_046, case_164, case_173}, {case_037, case_040, case_166, case_168}은 "2개의 검사 x 각각 복사본"이었다. 같은 검사는 corr 1.0000·bodyIoU 1.000, 서로 다른 검사는 corr <= 0.535·bodyIoU 0.56~0.60·잔차 평균 >= 293 HU로 완전히 갈린다. 즉 **조영 위가 다른 촬영이 아니라 서로 다른 환자**다.
- 따라서 기준을 널널하게 잡아도 트레이닝셋에 남는 시리즈 후보는 **0쌍**이다. 강도가 같으면 같은 검사(복사본), 강도가 다르면 다른 환자였다. "환자당 검사 1건"이라는 이전 결론이 화소 단위에서 재확인됐다.
- GT 라벨(nibabel 실측): uint8, 값 집합 {0,1,2}, 1=간(liver), 2=병변(lesion). 예 lv2-case_117 = 0:214,108,651 / 1:4,009,641 / 2:1,034,092. 앱 오버레이가 class 2만 그리는 것은 병변 표시가 맞다.
- 복사본끼리 GT가 완전히 같지는 않다(case_035 vs case_164 간 3,194,772 / 3,194,771, case_040 vs case_168 병변 122,480 / 125,016). 같은 CT에 주석 버전이 두 개 있다는 뜻이라 복사본 편으로 낸 지표와 원본 편으로 낸 지표가 서로 달라질 수 있다.
- lv2 fold_0 test20(case_041, case_089, case_113~case_130)은 복사본 그룹에 속하지 않는다(복사본 그룹의 최대 id는 215, test id는 130 이하). train 196 = 서로 다른 검사 111 + 복사본 85 = 196으로 계산이 맞물리므로 test 지표에 복사본 누수는 없다. 단 **train 196건의 실질 검사 수는 111건**이다.
- 앱 코호트: `compare_sources.json`의 CT 39건은 shape+spacing+affine 조합이 39개 모두 서로 달라 지오메트리 중복이 없다. 카드 41건과 CT 39건의 차이는 알려진 같은 검사 별칭 2건(case_000 <-> LL-CT-001, case_045 <-> LL-CT-003)이다.

### 정정
- 오전에 돌린 후보 스윕(`gt_series4.py` 등)은 NIfTI `datatype`을 오프셋 72에서 읽었다. 올바른 오프셋은 70이고 72는 `bitpix`다. 그래서 uint8 GT를 int32로 읽어 값 집합이 {0,1,2,256,257,...}로 보였고, 클래스를 개수 순서로 간/병변에 나누어 배정했다. 그 스크립트가 낸 offCdist·extMaxDiff·boxIoU 수치는 무효이므로 쓰지 않는다. shape/spacing/srow는 올바른 오프셋에서 읽었으므로 영향을 받지 않았고, "case_N <-> case_N+131 지오메트리 동일 83개"라는 후보 목록은 유효했다.
- 같은 원인 때문에 제기했던 "앱 lv2 카드가 간(liver)을 병변으로 그리는 것 아니냐"는 의심은 기각했다.

### 결정
- 트레이닝셋에서 시리즈를 찾는 시도는 여기서 끝낸다. 복사본을 짝지어 "이전 CT"로 보여주면 두 영상은 화소 단위로 같아서 경과 비교가 성립하지 않고, 실제 경과처럼 보이기 위한 창·위상 조작은 임상 데이터 위조이므로 쓰지 않는다.
- 실제 이전·다음 검사는 ① 3D-IRCADb-01의 사용조건·비식별 결정(현재 격리 중) 또는 ② 병원 PACS·비식별 다중검사 자료 수령 전까지 합성으로만 표시하고, 합성임을 라벨로 남긴다.