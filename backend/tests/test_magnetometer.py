from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
from netCDF4 import Dataset
import pytest

from suryakavach.ingest.magnetometer import read_mag_level2


def _write_mag_file(path) -> None:
    with Dataset(path, "w", format="NETCDF4") as dataset:
        dataset.createDimension("utc_time", 2)
        for name, values in {
            "time": [1_719_792_000.0, 1_719_792_010.0],
            "Bx_gse": [1.0, 2.0],
            "By_gse": [3.0, 4.0],
            "Bz_gse": [5.0, 6.0],
            "Bx_gsm": [7.0, 8.0],
            "By_gsm": [9.0, 10.0],
            "Bz_gsm": [11.0, 12.0],
            "Quality_flag_10s_data": [0.0, 1.0],
        }.items():
            variable = dataset.createVariable(name, "f8", ("utc_time",))
            variable[:] = values
            if name.startswith("B"):
                variable.units = "nano tesla - nT"


def test_read_mag_level2_reads_gse_vectors_quality_and_cadence(tmp_path):
    path = tmp_path / "mag.nc"
    _write_mag_file(path)

    series = read_mag_level2(path)

    assert series.coordinate_frame == "GSE"
    assert series.unit == "nano tesla - nT"
    assert series.timestamps[0] == datetime(2024, 7, 1, tzinfo=timezone.utc)
    assert series.bx.tolist() == [1.0, 2.0]
    assert series.bz.tolist() == [5.0, 6.0]
    assert series.quality.tolist() == [0.0, 1.0]
    assert series.cadence_seconds == 10.0


def test_read_mag_level2_rejects_unknown_coordinate_frame(tmp_path):
    path = tmp_path / "mag.nc"
    _write_mag_file(path)

    with pytest.raises(ValueError, match="coordinate_frame"):
        read_mag_level2(path, coordinate_frame="bad")
