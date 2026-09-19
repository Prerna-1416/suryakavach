from __future__ import annotations

"""Readers for archived Aditya-L1 FITS light-curve products.

The archived SoLEXS L1 light curve verified in PRADAN is a gzip-compressed FITS
binary table with ``RATE``/``TIME``/``COUNTS``. Counts are useful for detector
features, but are not silently treated as GOES-equivalent physical flux.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import shutil
from typing import Any
import zipfile

import astropy.units as u
import numpy as np
from astropy.io import fits
from astropy.time import Time, TimeDelta
from numpy.typing import NDArray

UTC = timezone.utc


@dataclass(frozen=True)
class FitsLightCurve:
    """A timestamped numerical series and the unit/provenance needed to use it safely."""

    timestamps: list[datetime]
    values: NDArray[np.float64]
    value_column: str
    value_unit: str
    extension_name: str
    header: dict[str, Any]

    @property
    def is_calibrated_flux(self) -> bool:
        """True only when the product itself declares a physical flux unit."""
        if not isinstance(self.value_unit, str) or not self.value_unit.strip():
            return False
        try:
            parsed = u.Unit(self.value_unit)
            return parsed.is_equivalent(u.W / (u.m**2))
        except Exception:
            return False


@dataclass(frozen=True)
class SuitImageFeature:
    """A deliberately simple, reproducible summary of one SUIT L1 image."""

    observed_at: datetime
    wavelength_angstrom: float | None
    exposure_seconds: float | None
    mean_signal: float
    p95_signal: float
    finite_fraction: float
    unit: str


def extract_product_archive(archive: str | Path, destination: str | Path) -> list[Path]:
    """Safely extract a PRADAN ZIP product, refusing path-traversal members."""
    archive_path = Path(archive)
    dst = Path(destination).resolve()
    dst.mkdir(parents=True, exist_ok=True)
    extracted: list[Path] = []
    with zipfile.ZipFile(archive_path) as zf:
        for member in zf.infolist():
            normalized_filename = member.filename.replace("\\", "/")
            relative = PurePosixPath(normalized_filename)
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"unsafe archive member: {member.filename}")
            target = dst.joinpath(*relative.parts).resolve()
            try:
                target.relative_to(dst)
            except ValueError:
                raise ValueError(f"unsafe archive member: {member.filename}")
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            extracted.append(target)
    return extracted


def read_fits_lightcurve(path: str | Path) -> FitsLightCurve:
    """Read a FITS/FITS.GZ light curve with absolute or MJD-relative time.

    The first binary table exposing a time column and a recognised numerical
    measurement column is used. Product units stay attached to the result so
    callers can require a calibration step before forecasting physical impact.
    """
    with fits.open(path, memmap=False) as hdul:
        for hdu in hdul:
            columns = getattr(hdu, "columns", None)
            data = getattr(hdu, "data", None)
            if columns is None or data is None or not columns.names:
                continue
            names = {name.lower(): name for name in columns.names}
            time_name = _first_name(names, ("time", "timestamp", "time_s", "met"))
            value_name = _first_name(names, ("flux", "rate", "counts", "count_rate", "intensity"))
            if time_name is None or value_name is None:
                continue
            header = dict(hdul[0].header)
            header.update(dict(hdu.header))
            values = np.asarray(data[value_name], dtype=np.float64)
            times = _timestamps(np.asarray(data[time_name], dtype=np.float64), header)
            unit = columns[value_name].unit or ("counts" if value_name.lower() == "counts" else "")
            return FitsLightCurve(
                timestamps=times,
                values=values,
                value_column=value_name,
                value_unit=str(unit),
                extension_name=hdu.name,
                header=header,
            )
    raise ValueError(f"no timestamped light-curve table found in {path}")


def read_hel1os_lightcurves(path: str | Path) -> dict[str, FitsLightCurve]:
    """Read every HEL1OS L1 light-curve energy band from one FITS product.

    HEL1OS L1 light curves use ``MJD``, ``ISOT``, ``CTR``, and ``STAT_ERR``
    columns. Count rates remain count rates; this reader intentionally performs
    no physical flux calibration.
    """
    curves: dict[str, FitsLightCurve] = {}
    with fits.open(path, memmap=False) as hdul:
        for hdu in hdul:
            columns = getattr(hdu, "columns", None)
            data = getattr(hdu, "data", None)
            if columns is None or data is None or not columns.names:
                continue
            names = {name.lower(): name for name in columns.names}
            isot_name = names.get("isot")
            value_name = names.get("ctr")
            if isot_name is None or value_name is None:
                continue
            timestamps = [_parse_isot(value) for value in data[isot_name]]
            curves[hdu.name] = FitsLightCurve(
                timestamps=timestamps,
                values=np.asarray(data[value_name], dtype=np.float64),
                value_column=value_name,
                value_unit=str(columns[value_name].unit or "cts/sec"),
                extension_name=hdu.name,
                header=dict(hdu.header),
            )
    if not curves:
        raise ValueError(f"no HEL1OS light-curve extensions found in {path}")
    return curves


def read_suit_image_feature(path: str | Path) -> SuitImageFeature:
    """Extract a transparent image statistic from one SUIT L1 FITS image.

    The summary is a diagnostic feature only. It carries native image units and
    does not represent a spatially resolved radiometric calibration.
    """
    with fits.open(path, memmap=False) as hdul:
        primary = hdul[0]
        image = np.asarray(primary.data, dtype=np.float64)
        header = primary.header
        observed = _parse_isot(str(header.get("DATE-OBS", "")))
        finite = image[np.isfinite(image)]
        if finite.size == 0:
            raise ValueError(f"SUIT image has no finite pixels: {path}")
        return SuitImageFeature(
            observed_at=observed,
            wavelength_angstrom=_float_or_none(header.get("WAVELNTH")),
            exposure_seconds=_float_or_none(header.get("EXPTIME")),
            mean_signal=float(np.mean(finite)),
            p95_signal=float(np.percentile(finite, 95)),
            finite_fraction=float(finite.size / image.size),
            unit=str(header.get("BUNIT", "")),
        )


def _first_name(names: dict[str, str], candidates: tuple[str, ...]) -> str | None:
    for candidate in candidates:
        if candidate in names:
            return names[candidate]
    return None


def _timestamps(values: NDArray[np.float64], header: dict[str, Any]) -> list[datetime]:
    if not np.all(np.isfinite(values)):
        raise ValueError("FITS TIME column contains non-finite values")
    # PRADAN SoLEXS L1 uses Unix seconds (around 1.7e9) even while also carrying
    # MJDREF metadata. Prefer that unambiguous representation when present.
    median = float(np.median(values)) if values.size else 0.0
    if 946_684_800 <= median <= 4_102_444_800:
        return [datetime.fromtimestamp(float(value), tz=UTC) for value in values]

    if "MJDREFI" not in header:
        raise ValueError("FITS TIME values are not Unix seconds and MJDREFI is absent")
    reference = Time(float(header["MJDREFI"]) + float(header.get("MJDREFF", 0.0)), format="mjd", scale="utc")
    unit = str(header.get("TIMEUNIT", "s")).lower()
    seconds_per_unit = {"s": 1.0, "sec": 1.0, "second": 1.0, "d": 86400.0, "day": 86400.0}.get(unit)
    if seconds_per_unit is None:
        raise ValueError(f"unsupported FITS TIMEUNIT: {unit}")
    resolved = reference + TimeDelta(values * seconds_per_unit, format="sec")
    return list(resolved.to_datetime(timezone=UTC))


def _parse_isot(value: object) -> datetime:
    text = value.decode() if isinstance(value, bytes) else str(value)
    text = text.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
        return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)
    except ValueError as exc:
        raise ValueError(f"invalid FITS ISO timestamp: {text}") from exc


def _float_or_none(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
