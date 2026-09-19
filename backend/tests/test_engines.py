from __future__ import annotations

import numpy as np
import pytest

from suryakavach.config import load_config
from suryakavach.engines.bocpd import BOCPD
from suryakavach.engines.evt import intensity_quantiles
from suryakavach.engines.forecast import DiscreteHazard, rolling_features, vectorize
from suryakavach.engines.impact import compute_impact, map_severity
from suryakavach.engines.calibration import fit_log_flux_calibration
from suryakavach.engines.neupert import neupert_correlation
from suryakavach.engines.nowcast import run_nowcast
from suryakavach.goes import class_letter, class_meets_min, goes_class
from suryakavach.ingest.synthetic import build_all_days, build_day, catalogue_injections


def test_goes_class():
    assert goes_class(5e-4) == "X5.0"
    assert goes_class(2.5e-5) == "M2.5"
    assert goes_class(1.2e-6) == "C1.2"
    assert goes_class(3.4e-7) == "B3.4"
    assert goes_class(5.0e-8) == "A5.0"
    assert goes_class(0.0) == "A0.0"

    assert class_letter("X6.3") == "X"
    assert class_letter("m2.1") == "M"
    assert class_meets_min("X1.0", "M") is True
    assert class_meets_min("C5.0", "M") is False


def test_bocpd():
    bocpd = BOCPD(hazard=0.004, max_run=100)
    data = np.concatenate([np.random.normal(0, 0.1, 50), np.random.normal(5, 0.1, 50)])
    cps = bocpd.run(data)
    assert len(cps) == 100
    # The windowed changepoint statistic must clearly separate the stable
    # baseline from the true shift at index 50 — not just be nonzero
    # everywhere (R[0] alone is constant == hazard regardless of the data,
    # so a bare "> 0" check would pass even for a broken detector).
    baseline = cps[10:45]
    around_shift = cps[50:56]
    assert np.mean(around_shift) > np.mean(baseline) * 5
    assert np.max(around_shift) > 0.5


def test_runtime_ffill_removes_nan_and_infinity_before_detection():
    """External telemetry must satisfy BOCPD's finite-input contract."""
    from suryakavach.runtime import _ffill

    filled = _ffill(np.array([1.0, np.nan, np.inf, 4.0, -np.inf]))

    assert np.all(np.isfinite(filled))
    assert filled.tolist() == [1.0, 1.0, 1.0, 4.0, 4.0]


def test_forecast_hazard():
    dh = DiscreteHazard()
    X = np.random.randn(50, 10)
    yc = np.random.choice([0.0, 1.0], size=50)
    ym = np.random.choice([0.0, 1.0], size=50)
    dh.fit(X, yc, ym)

    feat = {
        "sxr_mean": 1e-6,
        "sxr_std": 1e-7,
        "sxr_d1": 1e-8,
        "hxr_mean": 1e-7,
        "hxr_std": 1e-8,
        "hxr_d1": 1e-9,
        "hardness": 0.1,
        "neupert": 0.6,
        "minutes_since_flare": 30.0,
        "log_class": -6.0,
    }
    preds = dh.predict(feat, [5, 10, 20, 40])
    assert "horizons" in preds
    assert len(preds["horizons"]) == 4


def test_synthetic_ingest():
    injections = catalogue_injections()
    assert len(injections) > 0

    days = build_all_days(seed=42)
    assert "2024-02-22" in days
    d = days["2024-02-22"]
    assert len(d["solexs"]) == 1440
    assert len(d["hel1os"]) == 1440


def test_run_nowcast():
    cfg = load_config()
    days = build_all_days(seed=42)
    d = days["2024-02-22"]
    sxr = np.nan_to_num(d["solexs"], nan=np.nanmedian(d["solexs"]))
    hxr = np.nan_to_num(d["hel1os"], nan=np.nanmedian(d["hel1os"]))

    res = run_nowcast(sxr, hxr, cfg)
    assert len(res.posterior) == 1440
    assert len(res.events) > 0


def test_count_rate_flux_calibration_requires_matched_reference_and_preserves_units():
    counts = np.linspace(10.0, 1000.0, 30)
    expected_flux = 2e-8 * counts**1.2
    fitted = fit_log_flux_calibration(counts, expected_flux, "matched-goes-demo")

    assert fitted.sample_count == 30
    assert fitted.rmse_log10 < 1e-10
    assert np.allclose(fitted.apply([100.0]), [2e-8 * 100.0**1.2])
    assert fitted.metadata()["output_unit"] == "W/m2"


def test_count_rate_flux_calibration_rejects_insufficient_matches():
    with pytest.raises(ValueError, match="matched positive samples"):
        fit_log_flux_calibration([1.0, 2.0], [1e-8, 2e-8], "too-small")
