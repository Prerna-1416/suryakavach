from __future__ import annotations

"""Reader for Aditya-L1 MAG Level-2 NetCDF products."""

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from netCDF4 import Dataset
from numpy.typing import NDArray

UTC = timezone.utc


@dataclass(frozen=True)
class MagnetometerSeries:
    """MAG vector field samples in a declared coordinate frame and unit."""

    timestamps: list[datetime]
    bx: NDArray[np.float64]
    by: NDArray[np.float64]
    bz: NDArray[np.float64]
    quality: NDArray[np.float64] | None
    coordinate_frame: str
    unit: str
    cadence_seconds: float | None


def read_mag_level2(path: str | Path, coordinate_frame: str = "gse") -> MagnetometerSeries:
    """Read a MAG L2 product and retain its observed vector/quality semantics."""
    frame = coordinate_frame.lower()
    if frame not in {"gse", "gsm"}:
        raise ValueError("coordinate_frame must be 'gse' or 'gsm'")
    with Dataset(path, "r") as dataset:
        time_values = _required(dataset, "time")
        if not np.all(np.isfinite(time_values)):
            raise ValueError("MAG product time variable contains non-finite or missing values")
        bx = _required(dataset, f"Bx_{frame}")
        by = _required(dataset, f"By_{frame}")
        bz = _required(dataset, f"Bz_{frame}")
        quality = _values(dataset, "Quality_flag_10s_data")
        unit = str(getattr(dataset.variables[f"Bx_{frame}"], "units", ""))
        timestamps = [datetime.fromtimestamp(float(value), tz=UTC) for value in time_values]
        cadence = float(np.median(np.diff(time_values))) if len(time_values) > 1 else None
    return MagnetometerSeries(
        timestamps=timestamps,
        bx=bx,
        by=by,
        bz=bz,
        quality=quality,
        coordinate_frame=frame.upper(),
        unit=unit,
        cadence_seconds=cadence,
    )


def _required(dataset: Dataset, name: str) -> NDArray[np.float64]:
    values = _values(dataset, name)
    if values is None:
        raise ValueError(f"MAG product is missing required variable {name}")
    return values


def _values(dataset: Dataset, name: str) -> NDArray[np.float64] | None:
    variable = dataset.variables.get(name)
    if variable is None:
        return None
    raw = variable[:]
    if np.ma.is_masked(raw):
        raw = raw.filled(np.nan)
    return np.asarray(raw, dtype=np.float64)

