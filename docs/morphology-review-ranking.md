# Dataset-relative GT morphology review groups

`burden` is the default: **크기·개수 검토 그룹**, using Pareto layers of GT
largest connected-component volume (mL) and component count. These are descriptive,
unvalidated groups within the available dataset, not clinical severity, urgency,
diagnosis, stage, treatment eligibility, or a risk score. There are no clinical
cutoffs, weights, summed scores, or conversions to diameter.

## Fixed cohort and queue

`morphologyPriority` validates measurements using the existing rules. A measured
empty component list with count zero is known zero. Missing, invalid, or
inconsistent GT is unavailable, never a low group or zero.

`morphologyLayers(items)` takes the **full fixed available cohort**, including
reviewed and pinned cases. A dominates B when both measurements are at least as
large and at least one is larger. Nondominated cases form group 1; remove that
front and repeat to assign group 2 and later groups. Missing GT has a null group.
Tradeoffs such as (volume 1, count 100) and (volume 100, count 1) share the first
group if neither is dominated by another case. Exact ties share a group.

`compareMorphology` requires the full cohort layer map and manual-pin set;
computing layers from comparator pairs would not produce a valid cohort sort.
The default queue is:

1. Unreviewed before reviewed (completed always last).
2. Within each review state, manual pins before unpinned cases.
3. Within each pin group, known groups ascending, unavailable GT last.
4. Within each layer, case ID ascending.

A manual pin explicitly overrides unavailable GT placement, but never completion
placement. No case IDs are hardcoded in the policy. The current five examples,
all unreviewed/unpinned, are group 1: case_001, case_048; group 2: case_000,
case_035; group 3: case_045. Parent browser tests verify this from real metadata.

Completion, pinning, search, category and review filters do not change groups.
Changing the cohort or GT measurements can change groups: these are explicitly
**dataset-relative**, not cohort-independent categories. Queue ordinals can move
with review and pin state. The hero always selects the first unreviewed item
from the full default queue, regardless of selected UI sort or filters.

## Presentation and preserved behavior

Each card exposes `data-rank-policy="pareto-gt-vol-count"`, `data-review-group`
(`unknown` when unavailable), and `data-queue-ordinal`. The prominent ordinal is
from the full default queue. `.morphology-priority` and `.priority-reason-tags`
show the group and both actual measurements above unchanged ordinary tags.
Same-group text is “같은 그룹은 사례 번호순 · 의학적 우열 아님”. Missing GT,
missing AI predictions and the short emergency-unassessed status remain visible.
Repeated `.case-reason` and `.next-action-reason` sentences sit inside the actual
keyboard-operable `.rank-reasons` details, with their classes intact.

The hero gives its actual group, volume and count and labels the full default
scope. The header partitions all cases into pending group 1, other known pending
groups, unknown-GT pending, and completed cases. Pending pins are supplementary,
not a fifth partition. Group 1 pending can be zero while group 2 is next.

Legacy AI `priority`, disagreement, ID and total-volume sorts remain optional
with their prior rules. They do not change the hero or header policy. Technical
tag thresholds do not influence default groups. Storage, explicit CT opening,
focus restoration, stale callbacks, strict manifest validation, hospital model
panel and asset gates retain their contracts.

## Scientific distinction

Connected components use the existing 26-neighbor definition. Count may reflect
segmentation fragmentation or merged annotations; it is not a clinician-assessed
lesion count. Volume is voxel count times voxel volume. Clinical reference
applicability remains in [size-count-evidence.md](size-count-evidence.md), owned
by the parent. This grouping has no demonstrated clinical efficacy.

## Verification and historical notes

Synthetic tests cover dominance tradeoffs, ID ties, monotonicity, zero/invalid/
missing values, cohort dependence, stable groups across workflow changes,
reviewed-last/manual overrides, next-case progression, summary partitions and
markup contracts. Parent real-browser checks cover the five-case order, visible
tags, keyboard disclosure, filtered hero, fixed groups, hospital-panel isolation,
and existing CT/storage/security/focus regressions. Worker does not read medical
assets or use network; parent runs Node and real Chrome acceptance.

Superseded: the previous default ordered largest volume descending, using count
only for equal-volume ties. Earlier AI-band default prioritization is also
superseded; its rules survive only as an explicitly selected legacy mode.
