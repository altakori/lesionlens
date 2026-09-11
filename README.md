# LesionLens

여러 AI 신호를 바탕으로 추가 확인 가치가 큰 간 CT부터 보도록 돕는 교육·연구용 대시보드 MVP입니다.

## 현재 범위

- 합성 사례 기반 재검토 대기열
- 모델 불일치·작은 병변 후보·영상 품질 근거 표시
- 모든 사례를 유지하는 추가 확인 가치·영상 품질·사례 ID 정렬
- `먼저 확인`/`일반 순서`/`품질 확인` 상태와 사례별 이유 표시
- 사례를 클릭하면 열리는 선정 이유·확인 항목·해석 한계
- 생성형 합성 CT 그래픽은 제거하고, 로컬에 준비한 LiTS CT 3건은 별도 참고 대화상자에서만 표시
- 실제 CT의 LiTS 종양 정답 주석(GT) 켜기/끄기와 24절편 탐색
- 실제 진단·치료 결정을 하지 않는 human-in-the-loop 데모

## 실행

준비된 로컬 CT 자산을 보는 데 별도 설치는 필요하지 않습니다.

```bash
python scripts/serve_local.py
```

브라우저에서 `http://127.0.0.1:4173/?v=unified-1`을 엽니다. 서버는 `127.0.0.1`에만 바인딩되며 raw NIfTI, 로컬 provenance, Git 및 소스 경로 요청을 거부합니다.

## 실제 CT 로컬 준비

원본 NIfTI와 파생 이미지, 브라우저 manifest, 로컬 provenance는 모두 Git에서 제외되는 `data/real_cases/` 아래에 둡니다. 원본 쌍을 `data/real_cases/source/imagesTr`와 `data/real_cases/source/labelsTr`에 준비한 뒤 다음 명령으로 웹 자산을 재생성·검증합니다.

```bash
uv run --with nibabel --with pillow python scripts/prepare_real_cases.py
uv run --with nibabel --with pillow python scripts/prepare_real_cases.py --verify-only
```

현재 선택은 CAPPYv2의 고정 validation9와 test를 제외한 LiTS training subset 중 class-2 종양 양성인 작은 3건입니다. 변환기는 승인된 6개 원본 파일의 SHA-256을 고정 검증하고 CT/label의 shape, affine, voxel spacing, axial orientation 및 qform/sform 코드·행렬 정합성을 확인합니다. 생성된 WebP/PNG는 source slice·크기·SHA-256과 다시 대조하며, 서버는 manifest에 고정된 144개 이미지 경로와 해시만 제공합니다. 화면에는 로컬 별칭과 종양 주석을 가장 많이 포함하는 연속 24절편만 노출하며 GT 주석을 AI 예측과 분리해 표시합니다.

## 테스트

```bash
npm test
```

## 안전 경계

- 저장소에는 코드와 합성 데이터만 포함하며 실제 CT 파일은 로컬 `data/`에만 둡니다.
- 로컬 화면은 해시로 고정한 LiTS CT와 해당 데이터셋의 종양 정답 주석만 사용합니다. 외부 배포 전 원 출처·사용조건·비식별 범위를 별도로 확인해야 합니다.
- DICOM, 환자 식별자, 실제 임상 메타데이터, 모델 체크포인트를 커밋하지 않습니다.
- 실제 CT의 GT 주석은 AI 예측이 아니며, 합성 대기열 점수는 종양 확률이 아니라 “추가 확인 가치”를 뜻합니다.
- 정렬은 확인 순서만 바꾸며 낮은 순위나 필터 밖 사례가 안전하다는 뜻이 아닙니다.
- 보기 필터는 탐색용이며, 필터 밖 사례가 안전하거나 검토 불필요하다는 뜻이 아닙니다.
- 임상 성능과 일반화를 입증하는 제품이 아닙니다.

## 다음 단계

1. 영상의학과 의료진에게 사례 분류·라벨·최소 데모 화면을 검토받습니다.
2. 공개 데이터의 이용조건과 코호트 버전을 확인합니다.
3. 환자 단위 train/calibration/held-out 분리와 평가 계약을 코드로 동결합니다.
4. 고정 평가셋에서 같은 업무량의 무작위 대기열과 비교합니다.

## 1차 멘토링 반영 문서

- `docs/mentoring-session-01.md` — 녹취 근거, 결정사항, 액션 아이템
- `docs/project-draft.md` — 사용자·사례 분류·화면 목적을 반영한 프로젝트 초안
- `docs/mentoring-open-questions.md` — 다음 회차에서 확인할 질문과 필요한 결정
