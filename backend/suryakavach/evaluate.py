from __future__ import annotations

import hashlib
import json
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from suryakavach.config import load_config
from suryakavach.db import connect, save_evaluation_run
from suryakavach.engines.nowcast import run_nowcast
from suryakavach.evaluation import (
    EvaluationRun,
    bootstrap_confidence_intervals,
    compute_calibration_curve,
    compute_detection_metrics,
    compute_lead_time_stats,
    generate_markdown_report,
    match_events,
)
from suryakavach.evaluation.schemas import FailureSliceMetrics
from suryakavach.goes import goes_class
from suryakavach.ingest.synthetic import build_all_days


def compute_config_hash(cfg: dict[str, Any]) -> str:
    """Computes deterministic SHA-256 hash of configuration dictionary."""
    canonical_json = json.dumps(cfg, sort_keys=True)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def compute_dataset_hash(days: dict[str, Any]) -> str:
    """Computes SHA-256 hash over dataset days key structure and array checksums."""
    hasher = hashlib.sha256()
    for key in sorted(days.keys()):
        day = days[key]
        hasher.update(key.encode("utf-8"))
        sxr = day.get("solexs", np.array([]))
        hxr = day.get("hel1os", np.array([]))
        hasher.update(np.nan_to_num(sxr).tobytes())
        hasher.update(np.nan_to_num(hxr).tobytes())
    return hasher.hexdigest()


def get_git_revision() -> str:
    """Attempts to retrieve active git commit hash, returning fallback if git is unavailable."""
    try:
        res = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except Exception:
        pass
    return "untracked_workspace"


def _run_day_evaluation(
    day: dict[str, Any],
    cfg: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[float], list[float]]:
    """Runs nowcast engine on a single day, returning predicted events, truth events,
    predicted forecast probabilities, and true binary outcomes.
    """
    sxr = day["solexs"].copy()
    hxr = day["hel1os"].copy()

    # Forward-fill missing values
    last = np.nanmedian(sxr)
    for i in range(len(sxr)):
        if np.isnan(sxr[i]):
            sxr[i] = last
        else:
            last = sxr[i]

    last = np.nanmedian(hxr)
    for i in range(len(hxr)):
        if np.isnan(hxr[i]):
            hxr[i] = last
        else:
            last = hxr[i]

    nc = run_nowcast(sxr, hxr, cfg)

    pred_events = [
        {
            "onset_idx": ev.onset_idx,
            "peak_idx": ev.peak_idx,
            "peak_flux_sxr": ev.peak_flux_sxr,
            "class_label": ev.class_label,
            "duration": ev.duration_min(),
        }
        for ev in nc.events
    ]

    truth_events = [
        {
            "onset_idx": int((fl.onset - day["t0"]).total_seconds() // 60),
            "peak_idx": int((fl.peak - day["t0"]).total_seconds() // 60),
            "peak_flux_sxr": fl.peak_sxr,
            "class_label": getattr(fl, "class_label", goes_class(fl.peak_sxr)),
        }
        for fl in day["truth"]
    ]

    # Sample forecast probabilities vs truth outcomes per minute
    truth_onsets = {t["onset_idx"] for t in truth_events}
    y_true = []
    y_prob = []
    for i in range(len(nc.posterior)):
        prob = float(nc.posterior[i])
        is_true = 1 if any(abs(i - o) <= 15 for o in truth_onsets) else 0
        y_prob.append(prob)
        y_true.append(is_true)

    return pred_events, truth_events, y_true, y_prob


def run_evaluation(
    source_cohort: str = "synthetic",
    split_id: str = "synthetic-demo",
    cfg: dict[str, Any] | None = None,
    save_db: bool = True,
    db_path: Path | None = None,
) -> EvaluationRun:
    """Executes full backtesting evaluation, computes metrics, CIs, calibration,
    persists result to database, and writes output files.
    """
    cfg = cfg or load_config()
    days = build_all_days(int(cfg["data"]["seed"]))

    config_hash = compute_config_hash(cfg)
    dataset_hash = compute_dataset_hash(days)
    code_rev = get_git_revision()

    all_pred_events = []
    all_truth_events = []
    all_y_true = []
    all_y_prob = []
    day_eval_samples = []

    total_quiet_windows = 0

    for day_key, day in days.items():
        preds, truths, y_t, y_p = _run_day_evaluation(day, cfg)
        all_pred_events.extend(preds)
        all_truth_events.extend(truths)
        all_y_true.extend(y_t)
        all_y_prob.extend(y_p)
        total_quiet_windows += 12  # 12 nominal 2-hour quiet windows per day

        day_eval_samples.append({
            "day": day_key,
            "preds": preds,
            "truths": truths,
            "y_t": y_t,
            "y_p": y_p,
        })

    # Overall event matching
    match_res = match_events(
        all_pred_events,
        all_truth_events,
        match_window_min=15,
        total_quiet_windows=total_quiet_windows,
    )

    det_metrics = compute_detection_metrics(match_res.tp, match_res.fp, match_res.fn, match_res.tn)
    lead_stats = compute_lead_time_stats(match_res.lead_times)

    # Per-horizon Brier scores
    horizons = cfg.get("horizons", [5, 10, 20, 40])
    horizon_brier = {}
    for h in horizons:
        yt_h = []
        yp_h = []
        for sample in day_eval_samples:
            y_t_day = sample["y_t"]
            y_p_day = sample["y_p"]
            if len(y_p_day) > h:
                yt_h.extend(y_t_day[h:])
                yp_h.extend(y_p_day[:-h])
            else:
                yt_h.extend(y_t_day)
                yp_h.extend(y_p_day)

        if yt_h:
            brier_h = float(np.mean((np.array(yt_h) - np.array(yp_h)) ** 2))
        else:
            brier_h = float(np.mean((np.array(all_y_true) - np.array(all_y_prob)) ** 2)) if all_y_true else 0.0
        horizon_brier[h] = brier_h


    # Calibration Curve
    cal_curve = compute_calibration_curve(all_y_true, all_y_prob, n_bins=10)

    # Failure Slice Analysis
    failure_slices = {}

    # Slice 1: M-class+ flares
    m_truths = [t for t in all_truth_events if t.get("peak_flux_sxr", 0.0) >= 1e-5]
    m_preds = [p for p in all_pred_events if p.get("peak_flux_sxr", 0.0) >= 1e-5]
    m_match = match_events(m_preds, m_truths, match_window_min=15, total_quiet_windows=20)
    m_det = compute_detection_metrics(m_match.tp, m_match.fp, m_match.fn, m_match.tn)
    failure_slices["m_class_plus"] = FailureSliceMetrics(
        slice_name="M-class+ (>= 1e-5 W/m²)",
        sample_count=len(m_truths),
        tp=m_det.tp,
        fp=m_det.fp,
        fn=m_det.fn,
        tn=m_det.tn,
        tss=m_det.tss,
        hss=m_det.hss,
        far=m_det.far,
    )

    # Slice 2: X-class+ flares
    x_truths = [t for t in all_truth_events if t.get("peak_flux_sxr", 0.0) >= 1e-4]
    x_preds = [p for p in all_pred_events if p.get("peak_flux_sxr", 0.0) >= 1e-4]
    x_match = match_events(x_preds, x_truths, match_window_min=15, total_quiet_windows=10)
    x_det = compute_detection_metrics(x_match.tp, x_match.fp, x_match.fn, x_match.tn)
    failure_slices["x_class_plus"] = FailureSliceMetrics(
        slice_name="X-class+ (>= 1e-4 W/m²)",
        sample_count=len(x_truths),
        tp=x_det.tp,
        fp=x_det.fp,
        fn=x_det.fn,
        tn=x_det.tn,
        tss=x_det.tss,
        hss=x_det.hss,
        far=x_det.far,
    )

    # Bootstrap Confidence Intervals across day samples
    def evaluator_fn(sample_subset: list[dict[str, Any]]) -> dict[str, float]:
        sub_preds = []
        sub_truths = []
        sub_yt = []
        sub_yp = []
        for s in sample_subset:
            sub_preds.extend(s["preds"])
            sub_truths.extend(s["truths"])
            sub_yt.extend(s["y_t"])
            sub_yp.extend(s["y_p"])
        sub_match = match_events(sub_preds, sub_truths, match_window_min=15, total_quiet_windows=len(sample_subset) * 12)
        sub_det = compute_detection_metrics(sub_match.tp, sub_match.fp, sub_match.fn, sub_match.tn)
        sub_lead = compute_lead_time_stats(sub_match.lead_times)
        sub_brier = float(np.mean((np.array(sub_yt) - np.array(sub_yp)) ** 2)) if sub_yt else 0.0
        return {
            "tss": sub_det.tss,
            "hss": sub_det.hss,
            "far": sub_det.far,
            "lead_time_mean": sub_lead.mean,
            "brier_score": sub_brier,
        }

    cis = bootstrap_confidence_intervals(
        day_eval_samples,
        evaluator_fn,
        n_resamples=500,
        ci_level=0.95,
        seed=int(cfg["data"]["seed"]),
    )

    run_id = f"run_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    created_at = datetime.now(timezone.utc).isoformat()

    eval_run = EvaluationRun(
        id=run_id,
        created_at=created_at,
        source_cohort=source_cohort,
        split_id=split_id,
        config_hash=config_hash,
        dataset_hash=dataset_hash,
        code_revision=code_rev,
        model_version="bocpd_neupert_v1",
        detection_metrics=det_metrics,
        lead_time_stats=lead_stats,
        horizon_brier_scores=horizon_brier,
        confidence_intervals=cis,
        calibration_curve=cal_curve,
        failure_slices=failure_slices,
        sample_count=len(days),
    )

    # Output reports and persistence
    reports_dir = Path("reports")
    reports_dir.mkdir(parents=True, exist_ok=True)

    json_path = reports_dir / "evaluation_latest.json"
    json_path.write_text(json.dumps(eval_run.to_dict(), indent=2), encoding="utf-8")

    md_path = reports_dir / "metrics.md"
    md_content = generate_markdown_report(eval_run)
    md_path.write_text(md_content, encoding="utf-8")

    if save_db:
        db_p = db_path or Path(cfg["data"]["cache_path"]) / "suryakavach.db"
        conn = connect(db_p)
        try:
            save_evaluation_run(conn, eval_run.to_dict())
        finally:
            conn.close()

    return eval_run


def evaluate() -> str:
    """Backwards-compatible wrapper returning rendered markdown report string."""
    eval_run = run_evaluation()
    return generate_markdown_report(eval_run)


if __name__ == "__main__":
    print(evaluate())
