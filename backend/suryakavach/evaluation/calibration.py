from __future__ import annotations

import numpy as np

from suryakavach.evaluation.metrics import compute_brier_score
from suryakavach.evaluation.schemas import CalibrationCurve, CalibrationPoint


def compute_calibration_curve(
    y_true: list[int | float],
    y_prob: list[float],
    n_bins: int = 10,
) -> CalibrationCurve:
    """Computes reliability curve / calibration curve (binned predicted probability vs empirical positive rate)."""
    if not y_true or len(y_true) != len(y_prob):
        return CalibrationCurve()

    yt = np.array(y_true, dtype=np.float64)
    yp = np.array(y_prob, dtype=np.float64)

    bins = np.linspace(0.0, 1.0, n_bins + 1)
    points = []

    for i in range(n_bins):
        low, high = bins[i], bins[i + 1]
        if i == n_bins - 1:
            mask = (yp >= low) & (yp <= high)
        else:
            mask = (yp >= low) & (yp < high)

        count = int(np.sum(mask))
        bin_center = float((low + high) / 2.0)
        if count > 0:
            prob_pred = float(np.mean(yp[mask]))
            prob_true = float(np.mean(yt[mask]))
        else:
            prob_pred = bin_center
            prob_true = 0.0

        points.append(
            CalibrationPoint(
                bin_center=bin_center,
                prob_pred=prob_pred,
                prob_true=prob_true,
                count=count,
            )
        )

    brier = compute_brier_score(y_true, y_prob)

    # Climatological Brier Score baseline
    p_bar = float(np.mean(yt)) if len(yt) > 0 else 0.0
    brier_clim = float(np.mean((yt - p_bar) ** 2)) if len(yt) > 0 else 0.0
    bss = (1.0 - brier / brier_clim) if brier_clim > 0 else 0.0

    return CalibrationCurve(
        points=points,
        brier_score=brier,
        brier_skill_score=float(bss),
    )
