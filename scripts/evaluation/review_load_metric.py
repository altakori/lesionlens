"""검사전 추가 검토 후보 수(중복 제거) 탐색 측정.

입력: data/model_compare/evidence.json (모델별 3D 연결성분 후보와 사전 확정된
크로스모델 매칭 결과만 사용한다. 원시 마스크나 새로운 모델 추론은 쓰지 않는다.)

정의(문서: docs/review-load-metric.md):
- 분모: 후보 증거가 있는 검사(CT study) 수. 후보 증거가 없는 검사는 0으로 채우지
  않고 결측으로 별도 계상한다.
- 후보: 한 모델이 지목한 3D connected component(26연결) 1개.
- 중복 제거: 기록된 크로스모델 매칭(intersection/min component voxels >= 0.1)
  변을 union-find 로 묶어 같은 위치 후보를 1개로 계상.
- 고유 후보: union-find 그룹 수.
- 추가 후보: 어떤 모델과도 짝지어지지 않은 후보(단일 모델 흐름에서는 못 본 후보).
- 작음: reasons 에 kind=unmatched 이고 smallAdditional=true 로 기록된 후보.

결과는 탐색용이며 임상 민감도·업무시간 절감·임상 유효성이 아니다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import statistics
from fractions import Fraction
from pathlib import Path

REQUIRED_TOP = ("rules", "cases")
REQUIRED_CASE = ("models", "pairs", "reasons", "missingModels")


class ValidationError(ValueError):
    pass


def load_evidence(path: Path):
    raw = path.read_bytes()
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"evidence.json 을 UTF-8 JSON 으로 읽을 수 없음: {exc}") from exc
    if not isinstance(data, dict) or any(key not in data for key in REQUIRED_TOP):
        raise ValidationError("evidence.json 상위 키 부족: rules, cases")
    if not isinstance(data["cases"], dict) or not data["cases"]:
        raise ValidationError("cases 가 비어 있음")
    return data, hashlib.sha256(raw).hexdigest()


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, item: str) -> None:
        self.parent.setdefault(item, item)

    def find(self, item: str) -> str:
        root = item
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[item] != root:
            self.parent[item], item = root, self.parent[item]
        return root

    def union(self, left: str, right: str) -> None:
        self.add(left)
        self.add(right)
        a, b = self.find(left), self.find(right)
        if a != b:
            self.parent[max(a, b)] = min(a, b)

    def groups(self) -> int:
        return len({self.find(item) for item in self.parent})


def summarise(values: list[int]) -> dict:
    if not values:
        return {"per_exam": [], "denominator_exams": 0, "numerator_total": 0,
                "mean_exact": None, "mean": None, "median": None,
                "min": None, "max": None, "q1": None, "q3": None}
    ordered = sorted(values)
    quantiles = (statistics.quantiles(ordered, n=4, method="inclusive")
                 if len(ordered) >= 2 else [float(ordered[0]), float(ordered[0])])
    total = sum(ordered)
    return {
        "per_exam": ordered,
        "denominator_exams": len(ordered),
        "numerator_total": total,
        "mean_exact": str(Fraction(total, len(ordered))),
        "mean": round(total / len(ordered), 4),
        "median": statistics.median(ordered),
        "min": ordered[0],
        "max": ordered[-1],
        "q1": round(float(quantiles[0]), 4),
        "q3": round(float(quantiles[-1]), 4),
    }


def measure(cases: dict):
    rows = []
    excluded = []
    for case_id in sorted(cases):
        case = cases[case_id]
        missing = [key for key in REQUIRED_CASE if key not in case]
        if missing:
            raise ValidationError(f"{case_id}: case 키 부족 {missing}")
        models = case["models"]
        if not isinstance(models, dict):
            raise ValidationError(f"{case_id}: models 타입 오류")
        if not models:
            excluded.append({"case_id": case_id, "reason": "no_candidate_evidence",
                             "missing_models": case["missingModels"]})
            continue
        candidates: dict[str, str] = {}
        per_model: dict[str, int] = {}
        for model_name in sorted(models):
            model = models[model_name]
            ids = [str(c["id"]) for c in model.get("candidates", [])]
            if len(ids) != len(set(ids)):
                raise ValidationError(f"{case_id}/{model_name}: 후보 id 중복")
            declared = model.get("componentCount")
            if declared is not None and declared != len(ids):
                raise ValidationError(
                    f"{case_id}/{model_name}: componentCount {declared} != 후보 수 {len(ids)}")
            per_model[model_name] = len(ids)
            for cid in ids:
                candidates[cid] = model_name
        if not candidates:
            excluded.append({"case_id": case_id, "reason": "zero_candidates",
                             "missing_models": case["missingModels"]})
            continue
        uf = UnionFind()
        for cid in candidates:
            uf.add(cid)
        matched: set[str] = set()
        edge_count = 0
        for pair in case["pairs"]:
            for left, right in pair.get("matches", []):
                left, right = str(left), str(right)
                for cid in (left, right):
                    if cid not in candidates:
                        raise ValidationError(f"{case_id}: 매칭 후보 {cid} 가 후보 목록에 없음")
                uf.union(left, right)
                matched.add(left)
                matched.add(right)
                edge_count += 1
        small_ids = set()
        for reason in case["reasons"]:
            if reason.get("kind") != "unmatched":
                continue
            cid = str(reason.get("candidateId"))
            if cid not in candidates:
                raise ValidationError(f"{case_id}: reasons 후보 {cid} 미존재")
            if reason.get("smallAdditional") is True:
                small_ids.add(cid)
        unmatched_ids = sorted(set(candidates) - matched)
        rows.append({
            "case_id": case_id,
            "models": per_model,
            "candidate_total_raw": len(candidates),
            "match_edges": edge_count,
            "unique_candidates_after_dedup": uf.groups(),
            "additional_candidates_unmatched": len(unmatched_ids),
            "additional_candidates_unmatched_small": len(small_ids & set(unmatched_ids)),
            "unmatched_candidate_ids": unmatched_ids,
            "missing_models": case["missingModels"],
        })
    return rows, excluded


def main() -> int:
    parser = argparse.ArgumentParser(description="검사당 추가 검토 후보 수 탐색 측정")
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    data, sha = load_evidence(args.evidence)
    rows, excluded = measure(data["cases"])
    unique = [r["unique_candidates_after_dedup"] for r in rows]
    additional = [r["additional_candidates_unmatched"] for r in rows]
    small = [r["additional_candidates_unmatched_small"] for r in rows]
    per_model_max = [max(r["models"].values()) for r in rows]
    result = {
        "run": "review_load_metric",
        "input": {"evidence": args.evidence.name, "sha256": sha},
        "rules": data["rules"],
        "rows": rows,
        "excluded_missing": excluded,
        "metrics": {
            "unique_candidates_per_exam": summarise(unique),
            "additional_candidates_per_exam": summarise(additional),
            "additional_small_candidates_per_exam": summarise(small),
            "largest_single_model_candidates_per_exam": summarise(per_model_max),
        },
        "flags": {
            "exploratory": True,
            "clinical_validation": False,
            "cohort_is_demo_selection": True,
            "not_clinical_sensitivity": True,
            "no_time_metric": True,
        },
        "notes": "중복 제거 기준과 분모는 evidence.json rules 와 docs/review-load-metric.md 에 고정했다. "
                 "이 수치는 후보 부하 계수이며 임상 민감도·업무시간 절감이 아니다.",
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# 검사당 추가 검토 후보 수 (탐색)", "",
             f"- 입력: `{args.evidence.name}` sha256 `{sha[:16]}...`",
             f"- 분모(후보 증거가 있는 검사 수): {len(rows)}",
             f"- 결측(후보 증거 없음, 0으로 채우지 않음): {len(excluded)}"
             + (" -> " + ", ".join(e["case_id"] for e in excluded) if excluded else ""),
             f"- 중복 제거 기준: `{data['rules'].get('match')}` / 3D 연결성 {data['rules'].get('connectivity')}",
             "",
             "| 검사 | 모델별 후보 수 | 중복 제거 후 고유 후보 | 추가(미짝) 후보 | 그중 작음 |",
             "| --- | --- | --- | --- | --- |"]
    for row in rows:
        per_model = " / ".join(f"{m} {row['models'][m]}" for m in sorted(row["models"]))
        lines.append(f"| {row['case_id']} | {per_model} | {row['unique_candidates_after_dedup']} | "
                     f"{row['additional_candidates_unmatched']} | {row['additional_candidates_unmatched_small']} |")
    lines.append("")
    for key, label in (("unique_candidates_per_exam", "고유 후보"),
                       ("additional_candidates_per_exam", "추가 후보"),
                       ("additional_small_candidates_per_exam", "추가 후보 중 작음")):
        m = result["metrics"][key]
        lines.append(f"- {label}: 분자 {m['numerator_total']} / 분모 {m['denominator_exams']} = 평균 {m['mean']}"
                     f" (정확값 {m['mean_exact']}), 중간값 {m['median']}, 최소 {m['min']}, 최대 {m['max']},"
                     f" Q1 {m['q1']}, Q3 {m['q3']}")
    m = result["metrics"]["largest_single_model_candidates_per_exam"]
    lines.append(f"- 참고 단일 모델 최다 후보: 분자 {m['numerator_total']} / 분모 {m['denominator_exams']},"
                 f" 중간값 {m['median']}, 최대 {m['max']}")
    lines += ["", "탐색 전용. 임상 민감도·업무시간 절감·임상 유효성 주장에 쓰지 않는다.", ""]
    (args.out / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())