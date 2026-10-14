# 🩻 LesionLens

> 간 CT에서 "추가로 확인할 가치가 큰 검사"부터 보여 주는 AI 재검토 대기열 뷰어

<div align="center">

[![공개 데모](https://img.shields.io/badge/공개_데모-altakori.github.io%2Flesionlens-2ea44f?style=for-the-badge&logo=github)](https://altakori.github.io/lesionlens/)

🏆 **2026 IRB 경진대회 순위결정전 대상** · 2026-10-03, 서울대학교

[![2026 IRB 순위결정전 대상](https://img.shields.io/badge/2026_IRB-순위결정전_대상-gold)](https://github.com/altakori/lesionlens)
[![단계](https://img.shields.io/badge/Idea_to_Reality_with_Bigdata-교육부·한국연구재단-blue)](https://github.com/altakori/lesionlens)
[![용도](https://img.shields.io/badge/용도-교육·연구용_시연-orange)](#면책)

</div>

---

## 무엇을 만들었나

간 종양 분할 AI는 평균 성능이 양호해도 작은 병변을 놓칠 수 있고, 민감도를 높이면 오탐이 늘어 확인 부담이 커집니다. LesionLens는 AI가 진단을 확정하는 대신 다음 신호로 **재검토 대기열의 우선순위**를 정렬하는 접근을 다룹니다.

- 🔀 **모델 간 불일치** — 여러 분할 모델의 판단이 어긋난 위치
- ❓ **불확실성** — 예측에 신뢰 근거가 부족한 영역
- 🔍 **작은 병변 후보** — 평균 지표에서 사라지기 쉬운 대상
- 🖼 **영상 품질** — 판독·분석에 영향을 주는 신호

> 이 저장소의 데모는 `pages` 배포 기준 공개·합성 시연 화면입니다. 실제 7분 낭독 시간, 병원 내 실행, 임상 효과는 검증 대상이 아닙니다.

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `pages` | 공개 배포 브랜치 — [GitHub Pages](https://altakori.github.io/lesionlens/)가 이 브랜치의 정적 파일을 사용합니다 |
| `source/` | 원래 개발 저장소 기본 브랜치 `feat/mvp`의 파일 스냅샷 (전체 개발 브랜치의 최신 상태가 아님) |
| `source/*` 브랜치 | 원래 개발 저장소의 모든 브랜치를 원래 커밋 그대로 보존 |
| `legacy/source-pr/*` | 기존 개발 PR의 Git 커밋 보존 |

개발·테스트는 선택한 소스 브랜치의 README를 따릅니다.

## 진행 단계 (2026 IRB)

| 단계 | 일정 | 결과 |
|---|---|---|
| 순위 결정전 | 2026-10-03 | 🏆 대상 |
| 2차 인큐베이팅 | 2026-10-12 ~ 2026-11-06 | 진행 |
| CO-SHOW 현장 | 2026-11-20 | 예정 |

## 면책

교육·연구용 시연 앱이며 진단·치료용 임상 검증을 완료한 제품이 아닙니다. 기존 공개 배포 자료만 유지하며 새 로컬 의료 원본이나 미커밋 자료를 업로드하지 않았습니다. 데모의 모델 차이를 질병 위험이나 실제 경과 변화로 해석하지 마세요.
