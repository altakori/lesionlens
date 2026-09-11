# Mentoring 01 UI implementation brief

## Goal

Revise the static LesionLens MVP so a first-time non-developer can understand within one screen:

1. who uses it;
2. what “review priority” means;
3. why each case is ranked;
4. that every case remains in the queue;
5. that queue cases and synthetic workflow signals are research-demo fixtures rather than clinical probabilities, while the separate local viewer uses locally prepared LiTS CT with dataset GT.

## Product decisions that must remain true

- Provisional user assumption: radiologists and medical-imaging QA staff may use different parts of the workflow. Their priority, terminology, and actual workflow require clinician review.
- Purpose: sort the complete queue from visible workflow labels and observed synthetic signals; do not depend on an undisclosed numeric score.
- Default queue never removes lower-ranked cases.
- View filters are navigation aids only, never safety or diagnosis decisions.
- `먼저 확인`, `품질 확인`, `일반 순서` are workflow labels, not clinical urgency.
- Do not introduce urgency, metastasis, survival, curability, diagnosis, or treatment claims.
- Keep the CT reference in a contextual dialog using three locally prepared LiTS CT/GT cases. State that dataset GT is not AI output or a diagnosis, is unrelated to the selected synthetic case, and needs provenance/license/de-identification confirmation before external distribution.
- Preserve keyboard/wheel navigation only for the separately labeled local CT/GT reference dialog.
- Preserve the internal top-10/20/30 evaluation helpers if useful for research testing, but do not present them as the primary user queue control.

## Required interface changes

### Hero

- Replace “놓칠 가능성이 큰 검사” with a less overclaiming message centered on `추가 확인 가치가 큰 검사`.
- Add one concise sentence explaining the user and workflow.
- Keep the safety card prominent.

### Metrics

- Show complete queue count.
- Show counts for `먼저 확인` and `품질 확인`.
- If showing synthetic GT capture, label it explicitly as a research-demo evaluation and state its operating point; do not imply live clinical availability.

### Queue controls

- Replace the primary workload percentage selector with a sort selector:
  - 추가 확인 가치 순 (default)
  - 영상 품질 사례 우선
  - 사례 ID 순
- Every sort option must retain all cases unless the user explicitly applies a view filter.
- Keep visible text explaining that filters only change the view and that hidden cases are not declared safe.

### Case cards and detail

- Each card shows a clear text status label and at least one concrete reason tag.
- Use `검토 근거 보기` for synthetic queue cards; reserve CT wording for the separate local CT reference.
- Do not show unvalidated synthetic measurements or numeric scores. Use qualitative observed-signal labels until their formula and clinical criteria are validated.
- The selected detail shows the reason, what to inspect, and a concise limitation.

### Criteria section

Add a compact section explaining:

- 먼저 확인: model disagreement or a small/border candidate suggests additional review value.
- 품질 확인: spacing/quality signal requires technical confirmation. If signals overlap, keep all reasons in the detail while using the most actionable workflow label.
- 일반 순서: no current trigger; not a normal diagnosis and common model failures may remain.

### Accessibility and visual quality

- Keep visible labels; do not rely on icons alone.
- Maintain semantic headings, labels, `aria-pressed`, keyboard use, and responsive layout.
- Preserve the restrained clinical/research visual tone. Do not use photorealistic people or decorative medical imagery.

## Deterministic acceptance checks

- `npm test` passes.
- Static HTML contains `id="sortSelect"` and does not contain `id="workloadSelect"`.
- Queue copy explicitly states all cases remain and filters do not mean safety.
- Browser smoke at desktop and mobile widths: no horizontal overflow; queue selection, filters, sorting, rationale detail, and the local CT dialog's slice/keyboard/wheel controls continue to work.
- Browser console has no runtime errors.
- Implementation files are `index.html`, `app.js`, `styles.css`, and `tests/app.test.js`; transcript-attribution and unresolved-question corrections may also update `docs/mentoring-session-01.md`, `docs/mentoring-open-questions.md`, and this brief in the same reviewed snapshot.
