# 모델 비교·쉬운 한국어 UI 검증

## 반영
- 5개 공개 CT 사례, 전체 640장.
- case_000/001/035/048: 기본 nnU-Net·CAPPYv2·CP050 epoch1000 기존 예측. case_045: GT만, AI 없음 명시.
- 16개 원격 파일 원본 SHA256 대조. 기존 CT000/001은 추론 입력SHA동일, GT는 affine/배열동일.
- 모든 CT·GT·모델 PNG를 독립적인 transpose+양축반전 계산과 대조: 2,978개 이미지 전체 픽셀 검사 통과.
- converter --verify-only: 5cases/640slices/sourceBound true.
- npm test: Node12 통과, Python22 중1 Windows 실제 symlink생성 제외, 나머지 통과.
- npm run test:browser: Chrome12 통과. 1440/390/320px, 모델전환·같은 절편유지·CT만보기·없는예측·오래된요청·실패·키보드·focus복귀·명시적클릭전 이미지요청 없음.
- 320px 모델선택 toolbar 넘침을 grid 배치로 교정한 뒤 browser12 재통과.
- 실행HTTP에서 원본CT·예측NIfTI·서버주소receipt·소스명세·Git config 총5 경로404 확인.
- git diff --check 통과.

## 해석 범위
이미지 정합성과 UI 동작 확인이다. 임상 위험도·완치율·전이확률·모델 임상 우월성을 검증하지 않았다. 실제 사람 대상 이해도 테스트/MD 타당성 검토는 미실시다. 눈으로 스크린샷을 보고 판단한 미학 평가를 자동화 테스트 결과로 대신 주장하지 않는다.

## 상태
현재 접속: http://127.0.0.1:4173/?v=easy-compare-3
최신 서버의 launcher PID5104, 별도 로컬 로그사용. 원격모델 학습/추론 및 서버 변경 없음. 코드 변경은 로컬 미커밋이며 데이터는 Git-ignored 경로에 유지.
