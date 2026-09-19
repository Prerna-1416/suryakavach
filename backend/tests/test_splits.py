from __future__ import annotations

import json

import pytest

from suryakavach.splits import load_split_manifest


def test_split_manifest_requires_calibrated_and_date_disjoint_data(tmp_path):
    path = tmp_path / "split.json"
    path.write_text(json.dumps({
        "id": "observed-v1",
        "source_state": "observed_calibrated",
        "label_source": "authoritative-event-catalogue-v1",
        "created_at": "2026-09-19T00:00:00Z",
        "data_hashes": ["abc"],
        "splits": {
            "train": ["2024-01-01"],
            "calibration": ["2024-02-01"],
            "holdout": ["2024-03-01"],
        },
    }), encoding="utf-8")

    manifest = load_split_manifest(path)

    assert manifest.id == "observed-v1"
    assert manifest.splits["holdout"] == ("2024-03-01",)


def test_split_manifest_rejects_cross_split_day_leakage(tmp_path):
    path = tmp_path / "split.json"
    path.write_text(json.dumps({
        "id": "observed-v1",
        "source_state": "observed_calibrated",
        "label_source": "catalogue",
        "splits": {
            "train": ["2024-01-01"],
            "calibration": ["2024-01-01"],
            "holdout": ["2024-03-01"],
        },
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="both train and calibration"):
        load_split_manifest(path)
