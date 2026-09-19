from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np

from suryakavach.evaluation.schemas import ConfidenceInterval, DetectionMetrics, LeadTimeStats


def compute_detection_metrics(tp: int, fp: int, fn: int, tn: int) -> DetectionMetrics:
    """Computes binary classification skill scores (TSS, HSS, FAR, Precision, Recall, F1)
    ensuring zero-division safety.
    """
    sens = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    fp_rate = fp / (fp + tn) if (fp + tn) > 0 else 0.0
    tss = sens - fp_rate

    hss_num = 2.0 * (tp * tn - fp * fn)
    hss_den = (tp + fn) * (fn + tn) + (tp + fp) * (fp + tn)
    hss = float(hss_num / hss_den) if hss_den > 0 else 0.0

    far = float(fp / (tp + fp)) if (tp + fp) > 0 else 0.0
    precision = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = sens
    f1 = float(2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    return DetectionMetrics(
        tp=tp,
        fp=fp,
        fn=fn,
        tn=tn,
        tss=float(tss),
        hss=hss,
        far=far,
        precision=precision,
        recall=recall,
        f1=f1,
    )


def compute_lead_time_stats(lead_times: list[float]) -> LeadTimeStats:
    """Computes summary statistics for detected event lead times (in minutes)."""
    if not lead_times:
        return LeadTimeStats()

    arr = np.array(lead_times, dtype=np.float64)
    return LeadTimeStats(
        mean=float(np.mean(arr)),
        median=float(np.median(arr)),
        std=float(np.std(arr)),
        p25=float(np.percentile(arr, 25)),
        p75=float(np.percentile(arr, 75)),
        min_val=float(np.min(arr)),
        max_val=float(np.max(arr)),
    )


def compute_brier_score(y_true: list[int | float], y_prob: list[float]) -> float:
    """Computes Brier Score (Mean Squared Error between true binary outcome and forecast probability)."""
    if not y_true or len(y_true) != len(y_prob):
        return 0.0
    yt = np.array(y_true, dtype=np.float64)
    yp = np.array(y_prob, dtype=np.float64)
    return float(np.mean((yt - yp) ** 2))


def bootstrap_confidence_intervals(
    samples: list[Any],
    metric_evaluator: Callable[[list[Any]], dict[str, float]],
    n_resamples: int = 1000,
    ci_level: float = 0.95,
    seed: int = 42,
) -> dict[str, ConfidenceInterval]:
    """Computes non-parametric bootstrap confidence intervals over evaluation sample batches.

    ``metric_evaluator`` takes a resampled subset of ``samples`` and returns a dict mapping
    metric names to float values.
    """
    if not samples:
        return {}

    rng = np.random.default_rng(seed)
    n = len(samples)
    point_estimates = metric_evaluator(samples)

    bootstrap_results: dict[str, list[float]] = {k: [] for k in point_estimates}

    for _ in range(n_resamples):
        indices = rng.choice(n, size=n, replace=True)
        resampled = [samples[i] for i in indices]
        res_metrics = metric_evaluator(resampled)
        for k, val in res_metrics.items():
            if not math.isnan(val) and not math.isinf(val):
                bootstrap_results[k].append(val)

    alpha = (1.0 - ci_level) / 2.0
    lower_pct = alpha * 100.0
    upper_pct = (1.0 - alpha) * 100.0

    cis = {}
    for metric_name, values in bootstrap_results.items():
        point_val = point_estimates.get(metric_name, 0.0)
        if values:
            ci_lower = float(np.percentile(values, lower_pct))
            ci_upper = float(np.percentile(values, upper_pct))
        else:
            ci_lower = point_val
            ci_upper = point_val
        cis[metric_name] = ConfidenceInterval(
            metric_name=metric_name,
            point_estimate=point_val,
            ci_lower=ci_lower,
            ci_upper=ci_upper,
            confidence_level=ci_level,
        )

    return cis
