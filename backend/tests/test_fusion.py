from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pytest

from suryakavach.ingest.fusion import InstrumentSeries, fuse_to_minute_grid

UTC = timezone.utc


def test_fuse_to_minute_grid_aligns_cadences_and_preserves_units():
    grid = fuse_to_minute_grid(
        "2024-06-30",
        [
            InstrumentSeries(
                "solexs",
                "counts",
                [datetime(2024, 6, 30, 0, 0, second, tzinfo=UTC) for second in (0, 10, 20)],
                np.array([1.0, 2.0, np.nan]),
                "counts",
                "solexs.lc.gz",
            ),
            InstrumentSeries(
                "mag",
                "bz_gse",
                [datetime(2024, 6, 30, 0, 1, tzinfo=UTC)],
                np.array([-4.0]),
                "nT",
                "mag.nc",
            ),
        ],
    )

    assert grid.values["solexs.counts"][0] == 1.5
    assert np.isnan(grid.values["solexs.counts"][1])
    assert grid.quality["solexs.counts"][0] == 1
    assert grid.quality["solexs.counts"][1] == 0
    assert grid.values["mag.bz_gse"][1] == -4.0
    assert grid.units == {"solexs.counts": "counts", "mag.bz_gse": "nT"}
    assert grid.provenance["mag.bz_gse"] == "mag.nc"


def test_fuse_to_minute_grid_rejects_duplicate_channels():
    source = InstrumentSeries(
        "mag", "bz_gse", [datetime(2024, 6, 30, tzinfo=UTC)], np.array([1.0]), "nT", "a.nc"
    )
    with pytest.raises(ValueError, match="duplicate fusion channel"):
        fuse_to_minute_grid("2024-06-30", [source, source])
