# P1 review-fix handoff

All three REQUEST_CHANGES items are implemented. Work and synthetic fixtures stayed in this bounded workspace. No parent/external access, network, Git mutation, real CSV evaluation, measurement alteration, or real participant evaluation was performed by this worker.

## Changed files

- `matched_review_evaluation.py`: requires `case_id,candidate_rank,largest_component_ml,disagreement_score,fn_count`. Computes volume/disagreement ranks from descending measured values, with ascending case_id ties. Optional supplied baseline ranks must match exactly; reversed or arbitrary permutations fail. Reports comparison queues. FN remains independently supplied and is never synthesized.
- `toolkit_common.py`, `ranking_diagnostics.py`, `matched_review_evaluation.py`, `usability_records.py`: explicit `source_kind` required in APIs and `--source-kind` required on all CLIs (`synthetic`, `local_structural`, `supplied_evaluation`). Provenance includes input hash, all four code-file hashes, protocol hash, argv/cwd/Python version. CLI records actual arguments; API records equivalent replay arguments. Independent split and source authenticity verification remain false.
- `ranking_diagnostics.py`: enforces exact sphericity [0,1], including endpoints, using Decimal. No tolerance is justified by the supplied contract; out-of-range measurements fail without clipping or modification.
- `protocol.md`, `README.md`, `TASKS.md`: updated Korean schemas/commands, provenance contract, sphericity bounds, and distinction between synthetic code tests and allowed retrospective real structural diagnostics. Parent-reported real24 comparison (20 annotated positive-measurement rows / 4 no-annotation rows) is descriptive only and was not independently checked here.
- `tests/test_toolkit.py`: retained prior coverage and added independent reversed-rank rejection, measurement-derived queues, exact decimal/ID ties, missing/invalid baseline measurements, sphericity boundaries, required source flags, file-hash checks, and full CLI/API replay tests.
- `HANDOFF.md`: this compact replacement. `AGENTS.md` and the blank `usability_template.csv` remain unchanged.

## Verification

Command: `python3 -m unittest discover -s tests -v`

Final result: **Ran 53 tests in 3.191s — OK, exit code 0.** All fixtures are synthetic; temporary files are created and cleaned within this workspace. Successful and failing CLIs, JSON/Markdown output, Monte Carlo reproducibility, missing FN rejection, zero-FN undefined capture, and empty usability records are covered. Only this handoff was updated after the final passing run.

## Integration limits

- Breaking schema/API changes are intentional: old matched CSVs without actual baseline measurements now fail; every invocation needs an explicit source kind. Supplied measurements, disagreement-score construction, FN label origin, and participant authenticity cannot be independently verified by this toolkit. Document disagreement-score units/construction under the project metric contract.
- Structural comparisons do not establish clinical utility. FN burden capture is not clinical sensitivity. No independent split, preregistration, or MD evidence is claimed.
- Sphericity outside [0,1] requires upstream measurement-contract review, not alteration of real values to pass validation. Two-axis morphology remains fixed to volume/count.
- Replay requires preserved input/code/protocol files and compatible Python environment. API replay defaults to `replay_reports/<tool>`; CLI argv plus cwd preserves the original destination. Reusing output folders overwrites reports; validation failure leaves older reports in place, and write failures can leave a partial pair.
- Existing bounds remain: finite float magnitude for numeric inputs/FN total; worst-case O(N³) Pareto extraction; Monte Carlo storage proportional to repeats × budgets. No large-cohort benchmark or real-data rerun was performed here. Parent performs independent integration verification.
