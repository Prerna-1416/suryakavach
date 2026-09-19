from __future__ import annotations

"""Explicit count-rate to physical-flux calibration support.

Raw SoLEXS L1 products provide counts, not a GOES-equivalent W/m2 flux.  This
module deliberately requires matched reference observations before such values
can drive flare class or impact calculations.
"""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class FluxCalibration:
    calibration_id: str
    intercept: float
    slope: float
    rmse_log10: float
    sample_count: int

    def apply(self, counts: np.ndarray | list[float]) -> np.ndarray:
        values = np.asarray(counts, dtype=float)
        result = np.full(values.shape, np.nan, dtype=float)
        usable = np.isfinite(values) & (values > 0)
        result[usable] = np.power(10.0, self.intercept + self.slope * np.log10(values[usable]))
        return result

    def metadata(self) -> dict[str, float | int | str]:
        return {
            "calibration_id": self.calibration_id,
            "intercept": self.intercept,
            "slope": self.slope,
            "rmse_log10": self.rmse_log10,
            "sample_count": self.sample_count,
            "input_unit": "counts",
            "output_unit": "W/m2",
        }


def fit_log_flux_calibration(
    counts: np.ndarray | list[float],
    reference_flux_wm2: np.ndarray | list[float],
    calibration_id: str,
    *,
    min_samples: int = 20,
) -> FluxCalibration:
    """Fit ``log10(flux) = intercept + slope * log10(counts)``.

    Callers must supply time-aligned reference fluxes from a traceable source.
    A small, unpaired, or non-positive sample is rejected instead of yielding a
    plausible-looking calibration that could become an operational claim.
    """
    x = np.asarray(counts, dtype=float)
    y = np.asarray(reference_flux_wm2, dtype=float)
    if x.shape != y.shape:
        raise ValueError("counts and reference_flux_wm2 must have identical shapes")
    usable = np.isfinite(x) & np.isfinite(y) & (x > 0) & (y > 0)
    if int(np.count_nonzero(usable)) < min_samples:
        raise ValueError(f"at least {min_samples} matched positive samples are required")
    design = np.column_stack((np.ones(int(np.count_nonzero(usable))), np.log10(x[usable])))
    sol, residuals, rank, s_vals = np.linalg.lstsq(design, np.log10(y[usable]), rcond=None)
    if rank < 2:
        raise ValueError(f"design matrix is rank-deficient (rank {rank} < 2)")
    intercept, slope = sol
    residual = np.log10(y[usable]) - (intercept + slope * np.log10(x[usable]))

    return FluxCalibration(
        calibration_id=calibration_id,
        intercept=float(intercept),
        slope=float(slope),
        rmse_log10=float(np.sqrt(np.mean(residual**2))),
        sample_count=int(np.count_nonzero(usable)),
    )
