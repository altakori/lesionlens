# Technical recheck queue rules

This queue orders segmentation comparison work, not clinical urgency. These are authored, provisional project heuristics, not clinically validated thresholds. Missing predictions and unknown clinical information cannot establish reassuring findings. Clinical urgency remains “임상 응급도: 판단 자료 부족”. No patient condition, pathology, staging or prognosis is inferred.

## Ordering and workflow

Existing mode `sort=priority` (explicit selection): manual pins first, then ordinal band, then disagreement score descending within a band (null after known), then case ID for stable ties. Pins remain explicitly labelled manual; they do not change the automatic band. Bands are:

- **먼저 비교**: disagreement score ≥ 0.20.
- **이어서 확인**: any other technical attention tag or unavailable comparison data.
- **차례대로 확인**: no applicable technical attention tags; this is not a clinical clearance.

Cards show the default GT morphology queue ordinal (see [morphology ranking](morphology-review-ranking.md)), including manual overrides, independently of search, review state and category filters. ID and tumor-volume sorts preserve their previous behavior and do not apply pins; displayed overall rank still refers to the default morphology queue. In priority mode a separately labelled legacy comparison ordinal is also shown. The legacy disagreement sort preserves pins then descending score. Reviewed cases remain available under the all/reviewed filters. Pin and review persistence remain separate and manifest-version scoped.

`data-category=priority` selects **manual pins only**, matching “직접 먼저 보기 지정”. `disagreement` selects the automatic first band. All other category keys match the corresponding tags below. Categories intersect search and review filters. Category counts reflect that intersection before the selected category; `all` includes every matching case. Legacy `gt` includes all accepted cases, which all have GT.

## Overlapping tags and precise triggers

| Key / label | Source and trigger |
| --- | --- |
| disagreement / AI 표시 차이 큼 | AI `disagreement.score ≥ 0.20`; score = 1 − intersection/union of model masks, not GT accuracy or risk |
| countdiff / AI 표시 개수 다름 | At least two available models with different `componentCount`; connected mask components, not diagnosed lesion counts |
| volumediff / AI 표시 부피 다름 | At least two available models: max/min `volumeMl ≥ 1.5` when min > 0; also min = 0 and max > 0 (ratio undefined) |
| small / 작은 표시 포함 | GT has a `componentVolumesMl` value strictly > 0 and < 1 mL; component volume, not diameter or curability |
| multiple / 여러 표시 포함 | GT `componentCount ≥ 2`, using manifest 26-neighbor connected components |
| large / 전체 표시 부피 큼 | `tumorVolumeMl ≥ 20 mL`, the validated GT total, not one large lesion |
| extent / 여러 CT 장에 표시 | GT `positiveSliceCount / sliceCount ≥ 0.25`; image occupancy, not anatomical distribution or metastasis |
| missing / AI 비교 자료 없음 or AI 비교 자료 일부 없음 | Missing expected model(s) or null disagreement score; details list available count, missing sources and score availability |
| manual / 직접 먼저 보기 지정 | User pin = true, workflow only; excluded from automatic band derivation |

All applicable tags appear together with icon, text and source. Expandable details expose the actual values and thresholds for every triggered tag. Known zero values remain measurements: all-zero model volumes do not trigger a volume difference; zero versus positive does. Null comparisons are never converted into measured zero. The strict current manifest validator remains unchanged, including the valid model-absent case_045. Helpers handle partial model availability without relaxing ingestion validation.

## Scientific boundaries and references

- [ENA/ACEP Emergency Department Triage policy (2025)](https://www.ena.org/sites/default/files/2025-08/Emergency%20Department%20Triage.pdf): patient condition and validated triage inform clinical prioritization. Segmentation size is not sufficient to establish urgency.
- [ACR communication parameter](https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=74): distinguishes urgent findings from important discrepancies and supports documenting communicated findings. Only the general explainability/review principle is borrowed here. Differences between AI masks are not discrepancies between physician diagnoses.
- [NCI tumor grade](https://www.cancer.gov/about-cancer/diagnosis-staging/diagnosis/tumor-grade): grading requires tissue/pathologist assessment. [NCI staging](https://www.cancer.gov/about-cancer/diagnosis-staging/staging): staging involves extent, lymph nodes and spread. Current metrics cannot establish either or support prognosis.

**None of these sources validates the technical thresholds above.** No bleeding, invasion, nodal involvement, necrosis, grade, malignancy, growth, prognosis or clinical urgency tags are derived.

## Verification and integration

Node fixtures independently specify exact boundaries at 0.20, 1 mL, 20 mL, 0.25 and volume ratio 1.5; test overlapping tags, known zero/null/absent comparisons, stable ranking, manual-only filtering, persistence, intersection filters and escaping. Browser acceptance computes expected ranking and tags independently from the parent's manifest, exercises every category, global rank under filtering, pin persistence and explicit CT opening, and retains viewer/model/stale-load/focus/layout regressions.

Worker verification uses synthetic fixtures and code only. Parent must run Node unit tests and the real-manifest browser suite with the supplied visual files; real medical assets are not accessed by the worker.
