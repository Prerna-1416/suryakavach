from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


class BOCPD:
    """Gaussian-unknown-mean/variance BOCPD (Adams & MacKay 2007), truncated run length.

    The exposed changepoint probability is P(run length <= cp_window), i.e. the
    posterior mass that a change occurred within the last ``cp_window`` samples.
    R[0] alone ("a change happened at exactly this instant") is *not* used as the
    signal: with a constant hazard H (no run-length dependence), R[0] always
    normalizes to exactly H regardless of the data (cp = H * sum(R*pred), the
    growth mass is (1-H) * sum(R*pred), so cp / (cp + growth) == H identically) —
    it carries no information about the observed series. Summing over a small
    window of run lengths keeps the same Bayesian machinery but yields a
    genuinely data-driven signal that spikes when the run-length posterior
    concentrates near small r after a real shift.
    """

    def __init__(self, hazard: float = 0.004, max_run: int = 500, cp_window: int = 6):
        self.hazard = hazard
        self.max_run = max_run
        self.cp_window = cp_window
        self.mu0 = 0.0
        self.kappa0 = 1.0
        self.alpha0 = 1.0
        self.beta0 = 1.0
        self._reset()

    def _reset(self) -> None:
        self.t = 0
        self.R = np.ones(1)
        self.mean = np.array([self.mu0])
        self.kappa = np.array([self.kappa0])
        self.alpha = np.array([self.alpha0])
        self.beta = np.array([self.beta0])
        self.last_cp = 0.0

    def reset(self) -> None:
        self._reset()

    def update(self, x: float) -> float:
        x_val = float(x)
        if not np.isfinite(x_val):
            raise ValueError(f"BOCPD update requires finite float value, got {x}")
        t = min(self.t, self.max_run)
        pred = self._student_pdf(x_val, self.mean, self.kappa, self.alpha, self.beta)
        pred = np.clip(pred, 1e-300, None)

        growth = self.R * pred * (1.0 - self.hazard)
        cp = float(np.sum(self.R * pred * self.hazard))
        new_R = np.empty(t + 2)
        new_R[0] = cp
        new_R[1 : t + 2] = growth
        s = new_R.sum()
        if s <= 0:
            new_R[:] = 0.0
            new_R[0] = 1.0
        else:
            new_R /= s
        if new_R.size > self.max_run + 1:
            tail = new_R[self.max_run :].sum()
            new_R = new_R[: self.max_run + 1]
            new_R[-1] += tail

        new_mean, new_kappa, new_alpha, new_beta = self._update_params(x)
        self.R = new_R
        self.mean = new_mean
        self.kappa = new_kappa
        self.alpha = new_alpha
        self.beta = new_beta
        self.t += 1
        window = min(self.cp_window + 1, self.R.size)
        self.last_cp = float(np.sum(self.R[:window]))
        return self.last_cp

    def run(self, xs: NDArray[np.float64]) -> NDArray[np.float64]:
        arr = np.asarray(xs, dtype=np.float64)
        if arr.ndim != 1:
            raise ValueError(f"BOCPD.run requires 1D array input, got shape {arr.shape}")
        if not np.all(np.isfinite(arr)):
            raise ValueError("BOCPD.run requires all input elements to be finite float values")
        self.reset()
        out = np.empty(len(arr), dtype=np.float64)
        for i, v in enumerate(arr):
            out[i] = self.update(float(v))
        return out

    def _student_pdf(
        self,
        x: float,
        mean: NDArray[np.float64],
        kappa: NDArray[np.float64],
        alpha: NDArray[np.float64],
        beta: NDArray[np.float64],
    ) -> NDArray[np.float64]:
        var = beta * (kappa + 1.0) / (alpha * kappa)
        var = np.clip(var, 1e-12, None)
        z = (x - mean) / np.sqrt(var)
        nu = 2.0 * alpha
        # Student-t pdf up to a positive factor; relative weights suffice after normalize
        logp = (
            math_lgamma((nu + 1.0) / 2.0)
            - math_lgamma(nu / 2.0)
            - 0.5 * np.log(nu * np.pi * var)
            - ((nu + 1.0) / 2.0) * np.log1p((z * z) / nu)
        )
        return np.exp(np.clip(logp, -700, 700))

    def _update_params(self, x: float):
        k = self.kappa
        m = self.mean
        a = self.alpha
        b = self.beta

        new_kappa = np.empty(len(k) + 1)
        new_mean = np.empty(len(m) + 1)
        new_alpha = np.empty(len(a) + 1)
        new_beta = np.empty(len(b) + 1)

        new_kappa[0] = self.kappa0
        new_mean[0] = self.mu0
        new_alpha[0] = self.alpha0
        new_beta[0] = self.beta0

        new_kappa[1:] = k + 1.0
        new_mean[1:] = (k * m + x) / (k + 1.0)
        new_alpha[1:] = a + 0.5
        new_beta[1:] = b + (k * (x - m) ** 2) / (2.0 * (k + 1.0))

        if len(new_mean) > self.max_run + 1:
            new_mean = new_mean[: self.max_run + 1]
            new_kappa = new_kappa[: self.max_run + 1]
            new_alpha = new_alpha[: self.max_run + 1]
            new_beta = new_beta[: self.max_run + 1]

        return new_mean, new_kappa, new_alpha, new_beta


from scipy.special import gammaln


def math_lgamma(x: NDArray[np.float64] | float):
    return gammaln(x)
