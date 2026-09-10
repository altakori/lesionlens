import importlib.util
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

REPO = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


prepare = load_module("prepare_real_cases", REPO / "scripts" / "prepare_real_cases.py")
serve = load_module("serve_local", REPO / "scripts" / "serve_local.py")


class RealCaseSafetyTests(unittest.TestCase):
    def test_geometry_rejects_misaligned_label(self):
        image = nib.Nifti1Image(np.zeros((4, 4, 24)), np.eye(4))
        shifted = np.eye(4)
        shifted[0, 3] = 3
        label = nib.Nifti1Image(np.zeros((4, 4, 24)), shifted)
        with self.assertRaisesRegex(ValueError, "affine mismatch"):
            prepare.validate_geometry(image, label, "LL-CT-X")

    def test_selector_keeps_tumor_in_bimodal_edge_case(self):
        label = np.zeros((2, 2, 60), dtype=np.uint8)
        label[0, 0, 0] = 2
        label[0, 0, 59] = 2
        slices = prepare.select_slices(label)
        self.assertEqual(len(slices), 24)
        self.assertGreater(np.count_nonzero(label[:, :, slices] == 2), 0)

    def test_source_identity_fails_closed_on_unknown_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image, label = prepare.source_paths(root, "000")
            image.parent.mkdir(parents=True)
            label.parent.mkdir(parents=True)
            image.write_bytes(b"not-approved")
            label.write_bytes(b"not-approved")
            with self.assertRaisesRegex(ValueError, "source hash mismatch"):
                prepare.validate_source_identity(root, "000")

    def test_python_manifest_requires_browser_metadata_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "data" / "real_cases"
            cases = []
            for case_index in range(3):
                alias = f"LL-CT-00{case_index + 1}"
                slices = []
                for offset in range(1, 25):
                    name = f"{offset:02d}"
                    slices.append({
                        "index": offset,
                        "sourceSlice": offset + 9,
                        "width": 512,
                        "height": 512,
                        "ct": f"data/real_cases/web/{alias}/ct/{name}.webp",
                        "overlay": f"data/real_cases/web/{alias}/overlay/{name}.png",
                        "ctSha256": "a" * 64,
                        "overlaySha256": "b" * 64,
                        "tumorPixels": 1,
                    })
                cases.append({"id": alias, "sliceCount": 24, "slices": slices})
            manifest = {"version": prepare.MANIFEST_VERSION, "localOnly": True, "cases": cases}
            self.assertEqual(len(prepare.validate_manifest(root, manifest)), 144)
            del manifest["cases"][0]["slices"][0]["tumorPixels"]
            with self.assertRaisesRegex(ValueError, "tumor pixel count"):
                prepare.validate_manifest(root, manifest)

    def test_encoded_asset_hash_detects_tampering(self):
        content = prepare.encode_image(prepare.ct_to_image(np.zeros((8, 8))), "WEBP")
        self.assertNotEqual(prepare.bytes_sha256(content), prepare.bytes_sha256(content + b"tampered"))

    def test_local_server_denies_source_provenance_and_repo_files(self):
        handler = object.__new__(serve.SafeDemoHandler)
        handler.allowed_data_paths = {"/data/real_cases/web/LL-CT-001/ct/01.webp"}
        for path in (
            "/data/real_cases/source/imagesTr/case.nii.gz",
            "/data/real_cases/LOCAL_PROVENANCE.json",
            "/.git/config",
            "/scripts/prepare_real_cases.py",
            "/data/real_cases/web/secret.nii.gz",
            "/data/real_cases/web/LOCAL_PROVENANCE.json",
        ):
            handler.path = path
            self.assertFalse(handler._allowed(), path)
        for path in ("/", "/app.js?v=1", "/data/real_cases/manifest.json", "/data/real_cases/web/LL-CT-001/ct/01.webp"):
            handler.path = path
            self.assertTrue(handler._allowed(), path)


if __name__ == "__main__":
    unittest.main()
