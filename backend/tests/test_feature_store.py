from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pyarrow.parquet as pq

from suryakavach.ingest.feature_store import read_minute_grid_manifest, write_minute_grid
from suryakavach.ingest.fusion import InstrumentSeries, fuse_to_minute_grid


def test_feature_store_persists_value_quality_unit_and_source_hash(tmp_path):
    grid = fuse_to_minute_grid(
        "2024-02-12",
        [
            InstrumentSeries(
                "solexs", "counts", [datetime(2024, 2, 12, tzinfo=timezone.utc)],
                np.array([7.0]), "counts", "raw/solexs.zip",
            )
        ],
    )

    data_path = write_minute_grid(
        grid, tmp_path, "observed_uncalibrated", {"raw/solexs.zip": "hash-123"}
    )

    frame = pq.read_table(data_path).to_pylist()
    manifest = read_minute_grid_manifest(data_path)
    first = frame[0]
    assert first["value"] == 7.0
    assert first["quality"] == 1
    assert first["unit"] == "counts"
    assert first["source_hash"] == "hash-123"
    assert manifest["source_state"] == "observed_uncalibrated"
    assert manifest["feature_store_version"] == "observed-minute-grid-v1"
