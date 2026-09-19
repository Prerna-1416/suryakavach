from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from suryakavach.ingest.features import build_observed_grid
from suryakavach.ingest.fits_products import FitsLightCurve
from suryakavach.ingest.magnetometer import MagnetometerSeries


def test_observed_grid_preserves_native_count_and_magnetic_units():
    start = datetime(2024, 2, 12, tzinfo=timezone.utc)
    grid = build_observed_grid(
        "2024-02-12",
        solexs=FitsLightCurve([start], np.array([2.0]), "COUNTS", "counts", "RATE", {}),
        magnetometer=MagnetometerSeries(
            [start], np.array([3.0]), np.array([4.0]), np.array([12.0]), None, "GSE", "nT", None
        ),
        source_files={"solexs": "solexs.lc.gz", "mag": "mag.nc"},
    )

    assert grid.values["solexs.counts"][0] == 2.0
    assert grid.units["solexs.counts"] == "counts"
    assert grid.values["mag.magnitude_gse"][0] == 13.0
    assert grid.units["mag.magnitude_gse"] == "nT"
