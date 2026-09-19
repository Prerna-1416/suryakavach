from __future__ import annotations

"""Observed-instrument feature adapters built without implicit calibration."""

from pathlib import Path

import numpy as np

from suryakavach.ingest.fits_products import FitsLightCurve, SuitImageFeature
from suryakavach.ingest.fusion import FusedMinuteGrid, InstrumentSeries, fuse_to_minute_grid
from suryakavach.ingest.magnetometer import MagnetometerSeries


def build_observed_grid(
    day: str,
    solexs: FitsLightCurve | None = None,
    hel1os: dict[str, FitsLightCurve] | None = None,
    magnetometer: MagnetometerSeries | None = None,
    suit: SuitImageFeature | None = None,
    source_files: dict[str, str | Path] | None = None,
) -> FusedMinuteGrid:
    """Build a unit-aware minute grid from available observed instruments.

    Values stay in their native units. In particular, SoLEXS/HEL1OS count
    series are not converted to flux by this function.
    """
    paths = {name: str(path) for name, path in (source_files or {}).items()}
    series: list[InstrumentSeries] = []
    if solexs is not None:
        series.append(
            InstrumentSeries(
                "solexs", solexs.value_column.lower(), solexs.timestamps, solexs.values,
                solexs.value_unit, paths.get("solexs", ""),
            )
        )
    for band, curve in (hel1os or {}).items():
        channel = _safe_channel(band)
        series.append(
            InstrumentSeries(
                "hel1os", channel, curve.timestamps, curve.values,
                curve.value_unit, paths.get("hel1os", ""),
            )
        )
    if magnetometer is not None:
        mag_quality = (
            np.nan_to_num(magnetometer.quality, nan=0).astype(np.int8)
            if magnetometer.quality is not None
            else None
        )
        for axis, values in (("bx", magnetometer.bx), ("by", magnetometer.by), ("bz", magnetometer.bz)):
            series.append(
                InstrumentSeries(
                    "mag", f"{axis}_{magnetometer.coordinate_frame.lower()}", magnetometer.timestamps,
                    values, magnetometer.unit, paths.get("mag", ""),
                    quality=mag_quality,
                )
            )
        magnitude = np.sqrt(magnetometer.bx**2 + magnetometer.by**2 + magnetometer.bz**2)
        series.append(
            InstrumentSeries(
                "mag", f"magnitude_{magnetometer.coordinate_frame.lower()}", magnetometer.timestamps,
                magnitude, magnetometer.unit, paths.get("mag", ""),
                quality=mag_quality,
            )
        )
    if suit is not None:
        series.append(
            InstrumentSeries(
                "suit", "mean_signal", [suit.observed_at], np.array([suit.mean_signal]),
                suit.unit, paths.get("suit", ""),
            )
        )
    if not series:
        raise ValueError("at least one observed instrument series is required")
    return fuse_to_minute_grid(day, series)


def _safe_channel(label: str) -> str:
    return "_".join(part for part in label.lower().replace("-", "_").split("_") if part)
