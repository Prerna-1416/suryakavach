from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray


FEATURE_NAMES = (
    "sxr_mean",
    "sxr_std",
    "sxr_d1",
    "hxr_mean",
    "hxr_std",
    "hxr_d1",
    "hardness",
    "neupert",
    "minutes_since_flare",
    "log_class",
)


def rolling_features(
    sxr: NDArray[np.float64],
    hxr: NDArray[np.float64],
    window: int = 60,
    last_flare_idx: int | None = None,
) -> dict[str, float]:
    w = min(window, len(sxr))
    s = sxr[-w:]
    h = hxr[-w:]
    sxr_d1 = float(s[-1] - s[0]) / max(w, 1)
    hxr_d1 = float(h[-1] - h[0]) / max(w, 1)
    hardness = float(h[-1] / max(s[-1], 1e-12))
    if w > 3:
        ds = np.diff(s)
        cumh = np.cumsum(h[1:])
        n = min(len(ds), len(cumh))
        if ds[:n].std() > 0 and cumh[:n].std() > 0:
            neu = float(np.corrcoef(ds[:n], cumh[:n])[0, 1])
        else:
            neu = 0.0
    else:
        neu = 0.0
    if last_flare_idx is None:
        mins = float(w)
    else:
        mins = float(max(len(sxr) - 1 - last_flare_idx, 0))
    flux = max(float(s[-1]), 1e-12)
    return {
        "sxr_mean": float(s.mean()),
        "sxr_std": float(s.std()),
        "sxr_d1": sxr_d1,
        "hxr_mean": float(h.mean()),
        "hxr_std": float(h.std()),
        "hxr_d1": hxr_d1,
        "hardness": hardness,
        "neupert": neu,
        "minutes_since_flare": mins,
        "log_class": math.log10(flux),
    }


def vectorize(feat: dict[str, float]) -> NDArray[np.float64]:
    return np.array([feat[n] for n in FEATURE_NAMES], dtype=np.float64)


class ModelProvider:
    """Abstract interface for flare forecast model providers."""

    def predict(self, feat: dict[str, float], horizons: list[int]) -> dict[str, Any]:
        raise NotImplementedError


class DiscreteHazard(ModelProvider):
    """Calibrated discrete-time hazard: P(flare >= C1/M1) at 5/10/20/40 min."""

    def __init__(self) -> None:
        rng = np.random.default_rng(7)
        self.w_c = rng.normal(0, 0.05, size=len(FEATURE_NAMES))
        self.b_c = -2.2
        self.w_m = rng.normal(0, 0.05, size=len(FEATURE_NAMES))
        self.b_m = -3.4

    def fit(
        self,
        X: NDArray[np.float64],
        y_c: NDArray[np.float64],
        y_m: NDArray[np.float64],
        steps: int = 250,
        lr: float = 0.15,
    ) -> None:
        mu = X.mean(axis=0)
        sd = X.std(axis=0)
        sd[sd == 0] = 1.0
        self.mu = mu
        self.sd = sd
        Z = (X - mu) / sd
        self.w_c, self.b_c = self._sgd(Z, y_c, steps, lr, prior_b=-1.8)
        self.w_m, self.b_m = self._sgd(Z, y_m, steps, lr, prior_b=-2.8)

    def _sgd(
        self,
        Z: NDArray[np.float64],
        y: NDArray[np.float64],
        steps: int,
        lr: float,
        prior_b: float,
    ):
        w = np.zeros(Z.shape[1])
        b = prior_b
        n = len(y)
        for _ in range(steps):
            p = 1.0 / (1.0 + np.exp(-(Z @ w + b)))
            err = p - y
            w -= lr * (Z.T @ err) / n
            b -= lr * float(err.mean())
        return w, b

    def predict(self, feat: dict[str, float], horizons: list[int]) -> dict[str, Any]:
        x = vectorize(feat)
        mu = getattr(self, "mu", np.zeros_like(x))
        sd = getattr(self, "sd", np.ones_like(x))
        z = (x - mu) / sd
        p1_c = float(1.0 / (1.0 + math.exp(-float(z @ self.w_c + self.b_c))))
        p1_m = float(1.0 / (1.0 + math.exp(-float(z @ self.w_m + self.b_m))))
        p1_c = min(max(p1_c, 1e-4), 0.35)
        p1_m = min(max(p1_m, 1e-4), 0.20)
        out = []
        for h in horizons:
            pc = 1.0 - (1.0 - p1_c) ** h
            pm = 1.0 - (1.0 - p1_m) ** h
            out.append(
                {
                    "horizon_min": h,
                    "p_c1": round(min(pc, 0.99), 3),
                    "p_m1": round(min(pm, 0.99), 3),
                }
            )
        return {"horizons": out, "p1_c": p1_c, "p1_m": p1_m, "model_provider": "discrete_hazard_baseline"}


def get_model_provider(cfg: dict[str, Any] | None = None) -> ModelProvider:
    """Factory retrieving active forecast model provider via ModelRegistry."""
    from suryakavach.models.registry import ModelRegistry
    return ModelRegistry.get_provider(cfg)

