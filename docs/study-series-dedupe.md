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