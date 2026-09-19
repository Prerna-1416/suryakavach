from __future__ import annotations

"""Unit-aware common-grid alignment for observed Aditya-L1 instruments."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np
from numpy.typing import NDArray

UTC = timezone.utc
MINUTES_PER_DAY = 24 * 60


@dataclass(frozen=True)
class InstrumentSeries:
    """One observed scalar series before it is aligned to the mission minute grid."""

    instrument: str
    channel: str
    timestamps: list[datetime]
    values: NDArray[np.float64]
    unit: str
    source_file: str
    quality: NDArray[np.int8] | None = None


@dataclass(frozen=True)
class FusedMinuteGrid:
    """A loss-aware one-minute grid with no implicit cross-unit conversion."""

    day: str
    timestamps: list[datetime]
    values: dict[str, NDArray[np.float64]]
    quality: dict[str, NDArray[np.int8]]
    units: dict[str, str]
    provenance: dict[str, str]


def fuse_to_minute_grid(day: str, series: list[InstrumentSeries]) -> FusedMinuteGrid:
    """Align observed series by minute, averaging finite samples within each bin.

    Channel keys are ``<instrument>.<channel>``. The function does not
    calibrate, scale, or otherwise combine units across instruments; that must
    be an explicit feature-engineering/calibration step.
    """
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=UTC)
    timestamps = [start + timedelta(minutes=index) for index in range(MINUTES_PER_DAY)]
    values: dict[str, NDArray[np.float64]] = {}
    quality: dict[str, NDArray[np.int8]] = {}
    units: dict[str, str] = {}
    provenance: dict[str, str] = {}

    for item in series:
        if len(item.timestamps) != len(item.values):
            raise ValueError(f"timestamp/value length mismatch for {item.instrument}.{item.channel}")
        if item.quality is not None and len(item.quality) != len(item.values):
            raise ValueError(f"quality/value length mismatch for {item.instrument}.{item.channel}")
        key = f"{item.instrument}.{item.channel}"
        if key in values:
            raise ValueError(f"duplicate fusion channel {key}")
        grid, present = _minute_average(start, item.timestamps, item.values, item.quality)
        values[key] = grid
        quality[key] = present
        units[key] = item.unit
        provenance[key] = item.source_file
    return FusedMinuteGrid(day, timestamps, values, quality, units, provenance)


def _minute_average(
    start: datetime,
    timestamps: list[datetime],
    measurements: NDArray[np.float64],
    sample_quality: NDArray[np.int8] | None = None,
) -> tuple[NDArray[np.float64], NDArray[np.int8]]:
    sums = np.zeros(MINUTES_PER_DAY, dtype=np.float64)
    counts = np.zeros(MINUTES_PER_DAY, dtype=np.int64)
    for i, (timestamp, value) in enumerate(zip(timestamps, measurements)):
        if timestamp.tzinfo is None:
            raise ValueError("observed timestamps must be timezone-aware")
        if sample_quality is not None and sample_quality[i] <= 0:
            continue
        index = int((timestamp.astimezone(UTC) - start).total_seconds() // 60)
        if 0 <= index < MINUTES_PER_DAY and np.isfinite(value):
            sums[index] += float(value)
            counts[index] += 1
    result = np.full(MINUTES_PER_DAY, np.nan, dtype=np.float64)
    present = (counts > 0).astype(np.int8)
    result[present == 1] = sums[present == 1] / counts[present == 1]
    return result, present

