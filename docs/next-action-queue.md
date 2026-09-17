> 최신 정책: 전체GT 크기·개수 검토 그룹. morphology-review-ranking.md를 우선 참조한다. 아래 이전 size-first/AI-band 설명은 역사 기록이며 현재 기본 규칙이 아니다.

# Next-action queue

`selectNextCase(items, {first, reviewed})` is an exported pure helper. It returns
the highest-ranked unreviewed item, or `null`. It reuses the default `burden` morphology sort: manual pins first, known GT
measurements before unavailable GT within each pin group, largest connected-component
volume descending, component count descending only for equal largest volumes, then
case ID. This is descriptive ordering, not a combined clinical score. Search, category, visible-list sorting and review filters do not
affect the next case. The panel explicitly labels its default size/count queue;
card morphology ordinals also explain that other display sorts may differ. Inputs
are not mutated. See [scientific boundaries](morphology-review-ranking.md).

The parent supplies optional `#nextCase` and `#queueSummary` containers, styling
and live-region attributes. The app renders loading and failure states before
considering completion. An empty collection is distinct from a nonempty,
fully reviewed queue. The summary counts unreviewed band 0, other unreviewed,
reviewed, and emergency-unassessed cases across the entire collection.

The next-case native button has an accessible case-specific name and its own
delegated click handler. Only explicit activation opens CT and requests images.
Reviewing, pinning and filtering refresh the queue without opening the next CT.
Closing restores focus to the originating card or queue button; after advancing,
the next queue button receives focus, falling back to search when all are done.

Cards expose `data-review-band` and `data-reviewed`. New presentation uses
`.review-action-heading`, `.emergency-status` and `.next-action-reason` while
preserving the existing technical priority labels. Recommendations use actual
technical tags. Emergency findings remain unassessed for every case; no clinical
urgency or diagnosis is inferred from the technical queue.

## Verification handoff

- `node --test tests/app.test.js`: existing tests plus selection, state rendering,
  summary, recommendations, escaping and clinical-claim regression coverage.
- `tests/browser_capp_cases.py`: old card-open selectors now scope to `#caseList`;
  new tests cover keyboard opening, pin updates, search/category/sort/filter
  independence, review advancement, completion/undo, focus, loading/failure and
  absence of implicit CT requests.
- Local Python syntax validation passed. This WSL environment lacks Node and
  Playwright; execute the final unit/browser suites in the parent's Windows
  environment with its prepared local service and assets.
