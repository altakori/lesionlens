> 최신 기본 정렬: 크기·개수 검토 그룹(GT 최대 연결 표시 부피와 개수의 Pareto 그룹). 전체 자료 안의 상대 그룹이며 임상 중증도·응급도가 아닙니다. [정렬 규칙](docs/morphology-review-ranking.md) · [의학 자료 적용 범위](docs/size-count-evidence.md).

> 심사 반영 작업 전 [REVIEW_ACTION_GUIDE](docs/REVIEW_ACTION_GUIDE.md)를 읽습니다. 병원 맞춤 모델 화면은 UI만이며 업로드·학습·추론·저장은 연결되지 않았습니다.

> UI/UX 작업 전 [UI/UX 작업 기준](docs/UI_UX_GUIDE.md)을 읽습니다. 작업 입구: [AGENTS.md](AGENTS.md).

# LesionLens

## 저장소와 변경 이력

- 기존 비공개 저장소: https://github.com/altakori/LesionLens
- 현재 로컬 앱의 업로드 브랜치: `feat/inline-real-ct-local`. 기본 브랜치 병합과 공개 배포는 별도이며 이번 보존 작업에 포함하지 않습니다.
- 접속 주소는 `http://127.0.0.1:4173/` 하나를 사용합니다. 링크나 자산 이름 뒤에 수동 UI 버전 번호를 붙이지 않습니다.
- 이전 상태는 Git 커밋 이력에서 확인합니다. 화면 수정마다 버전 폴더·복사본을 새로 만드는 대신 같은 소스 파일을 갱신하고 커밋합니다. 기존 작업공간은 삭제하거나 이동하지 않습니다.
- 데이터셋·모델의 과학적 식별자와 브라우저 저장소의 데이터 버전 구분은 UI 수정 번호가 아니므로 유지합니다.
- 의료 원본·파생 영상, 인증정보, 실행 캐시, 새 QA 스크린샷은 업로드하지 않습니다. 저장소를 읽기 전용으로 잠그는 GitHub의 `Archive repository` 기능은 사용하지 않습니다.

공개 LiTS CT와 정답 표시(GT), 기존 연구 모델 3종의 예측을 같은 위치에서 살펴보는 로컬 앱입니다. 먼저 카드에서 확인할 이유를 읽고 **CT 보기**를 누릅니다. 작은/여러 표시의 이유에는 정답 표시 기준을 명시하며, 정확한 차이 백분율은 상세 정보에서만 보여줍니다. 카드 검색·분류·정렬만으로는 영상을 요청하거나 열지 않습니다.

- 사례: `case_000`, `case_001`, `case_035`, `case_045`, `case_048`의 전체 75·123·124·74·244장, 총 640장.
- AI: 기본 AI (nnU-Net), CAPPYv2, CAPPYv2+ 실험 (CP050 epoch1000). `case_045`에는 AI 예측이 없으며 비교 값을 만들어 넣지 않습니다.
- 영상에서 정답/AI/CT만 보기를 선택합니다. 모델을 바꿔도 같은 사례·같은 위치를 유지합니다. 표시 숨기기, 슬라이더, 이전/다음, 휠, 방향키, Home/End를 지원합니다.
- 닫기·Escape는 영상을 지우고 CT 보기 버튼으로 초점을 돌려줍니다. 불러오기 실패·사례/모델 변경·닫기 뒤에 도착한 이전 요청은 화면을 바꾸지 못합니다.
- 먼저 보기와 확인 완료는 서로 독립적으로 데이터셋 버전·사례 번호별 브라우저 저장소에 저장됩니다. 저장소가 막힌 경우 현재 화면에서만 유지된다고 안내합니다.
- 기본 `burden` 정렬은 전체 고정 사례(확인 완료·수동 지정 포함)에서 GT 최대 연결 표시 부피와 개수를 함께 비교한 ‘크기·개수 검토 그룹’입니다. 두 값 모두 작지 않고 하나 이상 큰 사례가 앞 그룹에 속하며, 같은 그룹은 사례 번호순입니다. 확인 전 → 각 확인 상태에서 수동 지정 → 알려진 그룹 → GT 자료 없음 순이고 확인 완료는 뒤에 옵니다. 수동 지정은 자료 없음도 먼저 배치합니다. 그룹은 확인·검색·필터로 바뀌지 않지만 자료 집합이 달라지면 바뀔 수 있고, 전체 대기열 순번은 작업 상태에 따라 이동합니다.
- 다음 사례와 헤더 집계는 화면 정렬·필터와 무관하게 전체 기본 대기열을 따릅니다. 카드의 그룹·두 측정값·일반 태그·응급 소견 미평가는 기본 상태에서 보이며, 반복 설명은 ‘이유와 측정값 자세히’에서 펼칩니다. 연결 표시 개수는 분할 조각화를 반영할 수 있으며 임상 병변 개수가 아닙니다. 알려진 0과 GT 자료 없음은 구분합니다.
- 이전 AI 차이 기반 `priority` 정렬은 선택 모드입니다(기본 정책으로서는 폐기됨). 수동 지정 → 재확인 단계 → 같은 단계에서 AI 차이 점수 → 사례 번호 규칙 및 일반 태그를 보존합니다. [이전 비교 규칙](docs/review-priority-rules.md)은 이 선택 모드에만 적용됩니다.

선별된 사례는 모델 성능을 평가하는 집단이 아닙니다. 차이는 모델 우월성·질병 위험도·생존·완치·전이 예측이 아닙니다. 진단·치료용으로 검증되지 않았습니다.

## 부모 호스트에서 준비 및 실행

원본 데이터는 승인된 로컬 데이터 보유 환경에서만 사용하며, 코드 작업자에게 전달하지 않습니다. 다운로드·원격 추론은 수행하지 않습니다. `data/` 전체는 저장소에서 제외됩니다.

```text
data/capp_cases/source/imagesTr/case_{000,001,045}_0000.nii.gz
data/capp_cases/source/labelsTr/case_{000,001,045}.nii.gz
data/model_compare/ct/case_{035,048}_0000.nii.gz
data/model_compare/gt/case_{035,048}.nii.gz
data/model_compare/{baseline,cappyv2,cp050}/case_{000,001,035,048}.nii.gz
```

중괄호는 필요한 파일 조합을 설명하는 표기입니다. 실제 파일 이름에 중괄호를 넣지 않습니다. 기존 세 사례 검증은 `prepare_capp_cases.py`의 SHA·geometry·GT 복셀 수 검증을 재사용합니다. 나머지는 `scripts/compare_sources.json`의 승인된 상대 경로·SHA-256·shape·affine·spacing·orientation·label 2 복셀 수로 검증합니다. CT의 label 2 복셀 수는 사용하지 않습니다. 원본은 변경하지 않습니다.

이미 설치된 numpy, nibabel, scipy, Pillow 환경에서 프로젝트 루트에서 실행합니다. Windows 명령은 `python`, Linux/WSL에서는 `python3`를 사용합니다.

```bash
python scripts/prepare_model_compare.py
python scripts/prepare_model_compare.py --verify-only
python scripts/serve_local.py
```

`http://127.0.0.1:4173`에서 엽니다. 새 manifest 적용에는 서버 재시작이 필요합니다. `--verify-only`는 승인된 원본에서 모든 측정값과 이미지 바이트를 다시 계산해 저장 결과와 비교하며 파일을 쓰지 않습니다.

모든 CT/GT/AI에 정확히 같은 유효 affine과 shape를 요구합니다. 유한한 CT 값과 affine, 유효한 spacing, 0/1/2 mask 값을 검사합니다. RAS 정렬 뒤 전치·양축 반전과 동등한 회전/반전으로 환자 오른쪽을 화면 왼쪽, 앞쪽을 위쪽에 표시합니다. CT는 HU −150~250을 8비트로 변환한 lossless WebP, 표시는 투명 PNG입니다. 원본 전체 절편을 저장하고 처음에는 GT 면적이 가장 큰 절편을 보여줍니다(동률이면 첫 절편).

## 측정값과 공개 스키마

`data/model_compare/manifest.json`, 버전 `lits-model-compare-v1`:

- 최상위: `version`, `localOnly`, `caseCount`, `windowHu`, `cases`.
- 사례: `id`, `sourceCaseId`, `sliceCount`, `dimensions`, `spacing`, `tumorVolumeMl`(GT 부피), `defaultSlice`(0부터), `gt`, `models`, `disagreement`, `slices`.
- `gt` 및 `models.{baseline,cappyv2,cp050}`: `voxels`, `volumeMl`, `componentVolumesMl`, `componentCount`, `positiveSliceCount`, `sliceSpan`. `case_045.models`는 빈 객체입니다.
- `disagreement`: `intersectionVoxels`, `unionVoxels`, `score`. `case_045`는 `null`입니다.
- 절편: `index`(1부터), `canonicalSlice`(RAS 정렬 후 0부터), `width`, `height`, `gtPixels`, `ct`, `ctSha256`, `pixels`, `overlays`. `pixels`는 출처별 label 2 복셀 수, `overlays`는 `gt`와 사용 가능한 AI별 `{path, sha256}`입니다.

표시 덩어리는 label 2의 26방향 연결 성분입니다. 임상 병변 개수가 아닙니다. 부피는 복셀 수 × affine에서 계산한 복셀 부피 / 1000(mL)입니다. `componentVolumesMl`은 큰 순서입니다. `positiveSliceCount`는 표시가 있는 절편 수, `sliceSpan`은 첫/마지막 표시의 1부터 시작하는 이미지 번호(빈 mask는 `null`)입니다. 사이 절편 모두가 양성이라는 뜻은 아닙니다. GT와 AI 측정값은 별도로 표시합니다.

세 모델 차이 점수는 `1 − 세 mask 교집합 복셀 수 / 합집합 복셀 수`입니다(합집합이 비면 0). 정답 대비 정확도나 임상 위험도가 아닙니다. 탐색 분류 기준은 차이 점수 ≥0.20, GT 덩어리 하나라도 <1mL이면 작은 표시, GT 덩어리 ≥2개면 여러 표시입니다. 임상 검증된 기준이 아닙니다.

공개 manifest에는 원본 경로·원시 헤더·원본 SHA·원격 경로·실행 영수증을 넣지 않습니다. `compare_manifest.py`는 허용 필드와 5개 사례, 복셀 수, 통계 일관성, 정확한 이미지 경로와 해시 형식을 검사합니다. 서버 시작 시 2,978개 자산의 해시를 확인해 manifest 바이트 스냅샷과 정확한 허용 목록을 만듭니다. 각 자산 요청 시 실제 바이트 해시를 다시 확인합니다.

현재 서버는 앱 네 파일과 **새 비교 manifest 및 그 자산만** 제공합니다. 이전 manifest 경로, 원본, 영수증, 스크립트, `.git`, 경로 이탈, 파일/상위 디렉터리 symlink는 차단합니다. 데이터 검증 실패 시 앱만 제공해 오류를 안내합니다. 루프백 바인딩과 외부 리소스를 막는 CSP를 유지합니다.

## 검증 및 호스트 인계

```bash
npm test
npm run test:browser
```

`npm test`는 Node 단위 테스트 및 `uv run --with nibabel --with pillow --with scipy python -m unittest discover -s tests -p "test_*.py"`를 실행합니다. 캐시에 의존성이 없으면 uv는 네트워크를 사용할 수 있으므로 제한된 작업 환경에서는 실행하지 않습니다. 설치된 환경에서 네트워크 없이 실행하려면 해당 Python으로 직접 unittest를 실행합니다.

브라우저 테스트는 준비된 실제 자산과 실행 중인 서버, Playwright, 설치된 Windows Chrome이 필요합니다. 기본 실행 파일은 `C:/Program Files/Google/Chrome/Application/chrome.exe`, 변경은 `CHROME_EXECUTABLE`로 지정합니다. `BASE_URL`은 기본 `http://127.0.0.1:4173`이며 루프백만 허용합니다. `QA_OUTPUT` 기본값은 `qa/capp-cases`입니다.

검증 범위는 5개 사례 전체 절편·출처별 표시 일치, 작은/여러 표시 기준, 모델 전환 중 동일 위치, 045 자료 없음, CT만 보기, 명시적 열기 전 이미지 요청 없음, 오래된 성공/실패·닫기 경합, 키보드/초점 복원, 검색/분류/수동 지정/확인 저장, 데스크톱 및 390/320px 폭입니다. Python은 독립적인 비대칭 방향 표식, 26방향 연결, affine/원본 SHA 검증, 비정상 스키마·경로·symlink·변경된 바이트 차단을 검사합니다.

기존 `prepare_capp_cases.py`, `prepare_real_cases.py`와 역사적 Python 테스트는 보존합니다. 과거 `browser_inline_ct.py`는 현재 앱 검증 진입점이 아닙니다. 부모 호스트가 실제 변환/verify-only, Windows npm 및 브라우저 검증, 원본과 표시 픽셀의 독립 대조를 담당합니다.
