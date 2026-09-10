#!/usr/bin/env python
"""Create local-only browser assets from exact approved NIfTI CT/label pairs.

All source and generated files stay under Git-ignored data/. Browser-visible
manifests use local aliases only; exact source identity remains in ignored local
provenance.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import nibabel as nib
import numpy as np
from PIL import Image, ImageFilter

CASES = [
    ("LL-CT-001", "000"),
    ("LL-CT-002", "131"),
    ("LL-CT-003", "045"),
]
EXPECTED_SHA256 = {
    "000": {
        "image": "5b41a5c4065094a3a8af45c01d49852d6ae5a215cc7807c318aef2744eb125f1",
        "label": "cac1212c0796bc9b98c3bb86f7a110c958f0552b0bec3f823591f7e00b79d362",
    },
    "131": {
        "image": "3009c1e9b72345dca96fd6bbf169416e53f6d699747784812b1f31e212572b1c",
        "label": "ca74478e48829d04ea7079a4e61bdf7c7817cf40155a56e3a3b3daad54f4f288",
    },
    "045": {
        "image": "1f63e67495bcf5520703500dcbe2cdcd4efc2885e974e5d6120fe6e22e157ff6",
        "label": "e13ff04b81b08efa2c9ff357dd27643036d5316bf369f10a3b9b460dfaf7fc4c",
    },
}
MANIFEST_VERSION = "ai0-lits-local-v1"
WINDOW_LOW = -150.0
WINDOW_HIGH = 250.0
SLICE_COUNT = 24
EXPECTED_FORM_CODES = {
    "LL-CT-001": {"qform": (1, 1), "sform": (1, 1)},
    "LL-CT-002": {"qform": (1, 1), "sform": (1, 1)},
    "LL-CT-003": {"qform": (0, 1), "sform": (2, 1)},
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_paths(root: Path, source_id: str) -> tuple[Path, Path]:
    source = root / "source"
    return (
        source / "imagesTr" / f"case_{source_id}_0000.nii.gz",
        source / "labelsTr" / f"case_{source_id}.nii.gz",
    )


def validate_source_identity(root: Path, source_id: str) -> tuple[Path, Path, str, str]:
    image_path, label_path = source_paths(root, source_id)
    if not image_path.is_file() or not label_path.is_file():
        raise FileNotFoundError(f"missing approved source pair for {source_id}")
    image_hash = sha256(image_path)
    label_hash = sha256(label_path)
    expected = EXPECTED_SHA256[source_id]
    if image_hash != expected["image"] or label_hash != expected["label"]:
        raise ValueError(f"source hash mismatch for {source_id}; refusing conversion")
    return image_path, label_path, image_hash, label_hash


def _matrix_and_code(obj: nib.Nifti1Image, kind: str) -> tuple[np.ndarray, int]:
    matrix, code = getattr(obj, f"get_{kind}")(coded=True)
    return np.asarray(matrix), int(code)


def validate_geometry(image_obj: nib.Nifti1Image, label_obj: nib.Nifti1Image, alias: str) -> None:
    if image_obj.shape != label_obj.shape:
        raise ValueError(f"geometry mismatch for {alias}: {image_obj.shape} != {label_obj.shape}")
    if not np.allclose(image_obj.affine, label_obj.affine, rtol=0, atol=1e-5):
        raise ValueError(f"affine mismatch for {alias}")
    image_zooms = np.asarray(image_obj.header.get_zooms()[:3], dtype=float)
    label_zooms = np.asarray(label_obj.header.get_zooms()[:3], dtype=float)
    if not np.allclose(image_zooms, label_zooms, rtol=0, atol=1e-6):
        raise ValueError(f"voxel spacing mismatch for {alias}")
    orientation = nib.aff2axcodes(image_obj.affine)
    if orientation != nib.aff2axcodes(label_obj.affine):
        raise ValueError(f"orientation mismatch for {alias}")
    if orientation[2] not in {"S", "I"} or orientation[0] in {"S", "I"} or orientation[1] in {"S", "I"}:
        raise ValueError(f"non-axial storage orientation for {alias}: {orientation}")
    for kind in ("qform", "sform"):
        image_matrix, image_code = _matrix_and_code(image_obj, kind)
        label_matrix, label_code = _matrix_and_code(label_obj, kind)
        expected_codes = EXPECTED_FORM_CODES[alias][kind]
        if (image_code, label_code) != expected_codes:
            raise ValueError(f"unexpected {kind} codes for {alias}")
        if kind == "sform" and (image_matrix.ndim != 2 or label_matrix.ndim != 2):
            raise ValueError(f"missing sform matrix for {alias}")
        if image_matrix.ndim == 2 and label_matrix.ndim == 2 and not np.allclose(image_matrix, label_matrix, rtol=0, atol=1e-5):
            raise ValueError(f"{kind} matrix mismatch for {alias}")


def select_slices(label: np.ndarray, count: int = SLICE_COUNT) -> list[int]:
    per_slice = np.count_nonzero(label == 2, axis=(0, 1)).astype(np.int64)
    positive_z = np.where(per_slice > 0)[0]
    if positive_z.size == 0:
        raise ValueError("label contains no class-2 tumor voxels")
    depth = label.shape[2]
    if depth < count:
        raise ValueError(f"series has fewer than {count} slices")
    rolling = np.convolve(per_slice, np.ones(count, dtype=np.int64), mode="valid")
    max_voxels = int(rolling.max())
    if max_voxels <= 0:
        raise ValueError("selected window would contain no class-2 tumor voxels")
    candidates = np.flatnonzero(rolling == max_voxels)
    tumor_center = float(np.average(np.arange(depth), weights=per_slice))
    start = int(min(candidates, key=lambda value: abs((value + (count - 1) / 2) - tumor_center)))
    slices = list(range(start, start + count))
    if int(per_slice[slices].sum()) <= 0:
        raise ValueError("selected window contains no class-2 tumor voxels")
    return slices


def ct_to_image(slice_data: np.ndarray) -> Image.Image:
    clipped = np.clip(np.nan_to_num(slice_data, nan=WINDOW_LOW), WINDOW_LOW, WINDOW_HIGH)
    normalized = ((clipped - WINDOW_LOW) / (WINDOW_HIGH - WINDOW_LOW) * 255).astype(np.uint8)
    return Image.fromarray(np.rot90(normalized))


def mask_to_overlay(mask: np.ndarray) -> Image.Image:
    binary = Image.fromarray((np.rot90(mask == 2) * 255).astype(np.uint8))
    dilated = binary.filter(ImageFilter.MaxFilter(5))
    eroded = binary.filter(ImageFilter.MinFilter(3))
    boundary = np.asarray(dilated, dtype=np.int16) > np.asarray(eroded, dtype=np.int16)
    fill = np.asarray(binary) > 0
    rgba = np.zeros((*fill.shape, 4), dtype=np.uint8)
    rgba[fill] = (255, 65, 139, 46)
    rgba[boundary] = (255, 82, 151, 235)
    return Image.fromarray(rgba)


def encode_image(image: Image.Image, fmt: str) -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    if fmt == "WEBP":
        image.save(buffer, "WEBP", quality=88, method=6)
    elif fmt == "PNG":
        image.save(buffer, "PNG", optimize=True)
    else:
        raise ValueError(f"unsupported image format: {fmt}")
    return buffer.getvalue()


def bytes_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def json_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")


def prepare(root: Path) -> None:
    web = root / "web"
    manifest_cases: list[dict[str, Any]] = []
    provenance_cases: list[dict[str, Any]] = []

    for alias, source_id in CASES:
        image_path, label_path, image_hash, label_hash = validate_source_identity(root, source_id)
        image_obj = nib.load(str(image_path))
        label_obj = nib.load(str(label_path))
        validate_geometry(image_obj, label_obj, alias)
        image = np.asanyarray(image_obj.dataobj)
        label = np.asanyarray(label_obj.dataobj)
        slices = select_slices(label)

        ct_dir = web / alias / "ct"
        overlay_dir = web / alias / "overlay"
        ct_dir.mkdir(parents=True, exist_ok=True)
        overlay_dir.mkdir(parents=True, exist_ok=True)
        slice_rows = []
        for display_index, source_slice in enumerate(slices, start=1):
            ct_name = f"{display_index:02d}.webp"
            overlay_name = f"{display_index:02d}.png"
            ct_path = ct_dir / ct_name
            overlay_path = overlay_dir / overlay_name
            ct_image = ct_to_image(image[:, :, source_slice])
            ct_content = encode_image(ct_image, "WEBP")
            mask = label[:, :, source_slice]
            overlay_content = encode_image(mask_to_overlay(mask), "PNG")
            ct_path.write_bytes(ct_content)
            overlay_path.write_bytes(overlay_content)
            slice_rows.append({
                "index": display_index,
                "sourceSlice": int(source_slice),
                "width": int(ct_image.width),
                "height": int(ct_image.height),
                "ct": f"data/real_cases/web/{alias}/ct/{ct_name}",
                "overlay": f"data/real_cases/web/{alias}/overlay/{overlay_name}",
                "ctSha256": bytes_sha256(ct_content),
                "overlaySha256": bytes_sha256(overlay_content),
                "tumorPixels": int(np.count_nonzero(mask == 2)),
            })

        manifest_cases.append({
            "id": alias,
            "sliceCount": SLICE_COUNT,
            "slices": slice_rows,
            "label": "공개 LiTS 학습 샘플 · 선택된 24절편",
        })
        provenance_cases.append({
            "alias": alias,
            "sourceCaseId": source_id,
            "imageSha256": image_hash,
            "labelSha256": label_hash,
            "shape": list(image.shape),
            "voxelSpacing": [float(x) for x in image_obj.header.get_zooms()[:3]],
            "selectedSourceSlices": slices,
            "tumorVoxelCount": int(np.count_nonzero(label == 2)),
        })

    manifest = {
        "version": MANIFEST_VERSION,
        "sourceLabel": "AI0에 보관된 공개 LiTS training subset의 승인된 로컬 사본",
        "localOnly": True,
        "notice": "연구 데모용 로컬 사본이며 Git 저장소에 포함되지 않습니다.",
        "cases": manifest_cases,
    }
    manifest_content = json_bytes(manifest)
    provenance = {
        "sourceHostAlias": "ai0",
        "dataset": "LiTS / Dataset003_Liver training subset",
        "selection": "validation9와 test 제외, class-2 tumor 양성 중 압축 CT 파일 크기가 작은 3건",
        "windowHu": [WINDOW_LOW, WINDOW_HIGH],
        "manifestSha256": bytes_sha256(manifest_content),
        "cases": provenance_cases,
    }
    root.mkdir(parents=True, exist_ok=True)
    (root / "manifest.json").write_bytes(manifest_content)
    (root / "LOCAL_PROVENANCE.json").write_bytes(json_bytes(provenance))


def validate_manifest(root: Path, manifest: dict[str, Any]) -> list[tuple[Path, str, str, int, int]]:
    if manifest.get("version") != MANIFEST_VERSION or manifest.get("localOnly") is not True:
        raise ValueError("invalid manifest version or localOnly boundary")
    rows = manifest.get("cases")
    expected_aliases = [alias for alias, _ in CASES]
    if not isinstance(rows, list) or [row.get("id") for row in rows] != expected_aliases:
        raise ValueError("manifest must contain the exact approved case aliases in order")

    repo_root = root.parent.parent.resolve()
    web_root = (root / "web").resolve()
    assets: list[tuple[Path, str, str, int, int]] = []
    for case in rows:
        alias = case["id"]
        slices = case.get("slices")
        if case.get("sliceCount") != SLICE_COUNT or not isinstance(slices, list) or len(slices) != SLICE_COUNT:
            raise ValueError(f"invalid slice count for {alias}")
        for offset, row in enumerate(slices, start=1):
            filename = f"{offset:02d}"
            expected = {
                "ct": f"data/real_cases/web/{alias}/ct/{filename}.webp",
                "overlay": f"data/real_cases/web/{alias}/overlay/{filename}.png",
            }
            hashes = {"ct": row.get("ctSha256"), "overlay": row.get("overlaySha256")}
            if row.get("index") != offset or any(row.get(key) != value for key, value in expected.items()):
                raise ValueError(f"invalid manifest path or index for {alias} slice {offset}")
            if not isinstance(row.get("sourceSlice"), int) or row["sourceSlice"] < 0:
                raise ValueError(f"invalid source slice for {alias} slice {offset}")
            if row.get("width") != 512 or row.get("height") != 512:
                raise ValueError(f"invalid dimensions for {alias} slice {offset}")
            if not isinstance(row.get("tumorPixels"), int) or row["tumorPixels"] < 0:
                raise ValueError(f"invalid tumor pixel count for {alias} slice {offset}")
            if any(not isinstance(value, str) or len(value) != 64 or any(char not in "0123456789abcdef" for char in value) for value in hashes.values()):
                raise ValueError(f"invalid derived hash for {alias} slice {offset}")
            for key, relative in expected.items():
                unresolved = repo_root / relative
                candidate = unresolved.resolve()
                if unresolved.is_symlink() or not candidate.is_relative_to(web_root):
                    raise ValueError(f"asset escapes web root or is symlinked: {relative}")
                fmt = "WEBP" if key == "ct" else "PNG"
                assets.append((candidate, hashes[key], fmt, row["width"], row["height"]))
    return assets


def verify(root: Path) -> None:
    from io import BytesIO

    manifest_path = root / "manifest.json"
    provenance_path = root / "LOCAL_PROVENANCE.json"
    if not manifest_path.is_file() or not provenance_path.is_file():
        raise FileNotFoundError("manifest.json or LOCAL_PROVENANCE.json is missing")
    manifest_content = manifest_path.read_bytes()
    manifest = json.loads(manifest_content.decode("utf-8"))
    assets = validate_manifest(root, manifest)

    for path, expected_hash, expected_format, width, height in assets:
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"missing or empty derived asset: {path}")
        content = path.read_bytes()
        if bytes_sha256(content) != expected_hash:
            raise RuntimeError(f"derived asset hash mismatch: {path}")
        try:
            with Image.open(BytesIO(content)) as decoded:
                decoded.load()
                if decoded.format != expected_format or decoded.size != (width, height):
                    raise RuntimeError(f"derived asset format or dimensions mismatch: {path}")
        except Exception as exc:
            raise RuntimeError(f"derived asset is not decodable: {path}") from exc

    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    if provenance.get("sourceHostAlias") != "ai0" or provenance.get("dataset") != "LiTS / Dataset003_Liver training subset":
        raise ValueError("unexpected local provenance source")
    if provenance.get("manifestSha256") != bytes_sha256(manifest_content):
        raise ValueError("manifest is not bound to local provenance")
    provenance_rows = provenance.get("cases")
    if not isinstance(provenance_rows, list) or len(provenance_rows) != len(CASES):
        raise ValueError("invalid local provenance cases")

    for case_index, (alias, source_id) in enumerate(CASES):
        image_path, label_path, image_hash, label_hash = validate_source_identity(root, source_id)
        provenance_row = provenance_rows[case_index]
        if provenance_row.get("alias") != alias or provenance_row.get("sourceCaseId") != source_id or provenance_row.get("imageSha256") != image_hash or provenance_row.get("labelSha256") != label_hash:
            raise ValueError(f"local provenance identity mismatch for {alias}")
        image_obj = nib.load(str(image_path))
        label_obj = nib.load(str(label_path))
        validate_geometry(image_obj, label_obj, alias)
        image = np.asanyarray(image_obj.dataobj)
        label = np.asanyarray(label_obj.dataobj)
        selected_slices = select_slices(label)
        case_rows = manifest["cases"][case_index]["slices"]
        if [row["sourceSlice"] for row in case_rows] != selected_slices:
            raise ValueError(f"manifest source-slice binding mismatch for {alias}")
        if sum(row["tumorPixels"] for row in case_rows) <= 0:
            raise ValueError(f"selected window has no tumor voxels for {alias}")
        for row, source_slice in zip(case_rows, selected_slices):
            mask = label[:, :, source_slice]
            expected_ct = encode_image(ct_to_image(image[:, :, source_slice]), "WEBP")
            expected_overlay = encode_image(mask_to_overlay(mask), "PNG")
            if bytes_sha256(expected_ct) != row["ctSha256"] or bytes_sha256(expected_overlay) != row["overlaySha256"]:
                raise RuntimeError(f"derived asset is not bound to approved source for {alias} slice {row['index']}")
            if row["tumorPixels"] != int(np.count_nonzero(mask == 2)):
                raise RuntimeError(f"tumor pixel metadata mismatch for {alias} slice {row['index']}")

    print(json.dumps({"cases": len(CASES), "slicesPerCase": SLICE_COUNT, "assets": len(assets), "missing": 0, "sourceBound": True}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("data/real_cases"))
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if not args.verify_only:
        prepare(args.root)
    verify(args.root)


if __name__ == "__main__":
    main()
