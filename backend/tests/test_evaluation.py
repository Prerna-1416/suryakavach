from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from suryakavach.db import _sqlite_connect, get_latest_evaluation_run, save_evaluation_run
from suryakavach.evaluate import run_evaluation
from suryakavach.evaluation import (
    CalibrationCurve,
    CalibrationPoint,
    ConfidenceInterval,
    DetectionMetrics,
    EvaluationRun,
    LeadTimeStats,
    bootstrap_confidence_intervals,
    compute_calibration_curve,
    compute_detection_metrics,
    compute_lead_time_stats,
    generate_markdown_report,
    match_events,
)


def test_detection_metrics_zero_division():
    dm = compute_detection_metrics(0, 0, 0, 0)
    assert dm.tss == 0.0
    assert dm.hss == 0.0
    assert dm.far == 0.0
    assert dm.precision == 0.0
    assert dm.recall == 0.0
    assert dm.f1 == 0.0


def test_detection_metrics_calculation():
    # TP=80, FP=20, FN=20, TN=80
    dm = compute_detection_metrics(80, 20, 20, 80)
    # Sensitivity = 80/100 = 0.8, FP rate = 20/100 = 0.2 -> TSS = 0.6
    assert pytest.approx(dm.tss, 0.001) == 0.6
    assert pytest.approx(dm.far, 0.001) == 0.2
    assert pytest.approx(dm.precision, 0.001) == 0.8
    assert pytest.approx(dm.recall, 0.001) == 0.8
    assert pytest.approx(dm.f1, 0.001) == 0.8


def test_event_matching():
    preds = [
        {"onset_idx": 10, "peak_flux_sxr": 1e-4},
        {"onset_idx": 100, "peak_flux_sxr": 2e-5},
    ]
    truths = [
        {"onset_idx": 12, "peak_idx": 25, "peak_flux_sxr": 1e-4},
        {"onset_idx": 200, "peak_idx": 215, "peak_flux_sxr": 5e-5},
    ]

    res = match_events(preds, truths, match_window_min=15, total_quiet_windows=10)
    assert res.tp == 1
    assert res.fp == 1
    assert res.fn == 1
    assert len(res.lead_times) == 1
    assert res.lead_times[0] == 15.0  # truth_peak(25) - pred_onset(10) = 15


def test_lead_time_stats():
    lead_times = [5.0, 10.0, 15.0, 20.0, 25.0]
    stats = compute_lead_time_stats(lead_times)
    assert stats.mean == 15.0
    assert stats.median == 15.0
    assert stats.min_val == 5.0
    assert stats.max_val == 25.0


def test_calibration_curve():
    y_true = [0, 0, 0, 0, 1, 1, 1, 1]
    y_prob = [0.1, 0.2, 0.15, 0.25, 0.8, 0.85, 0.9, 0.75]
    curve = compute_calibration_curve(y_true, y_prob, n_bins=5)

    assert isinstance(curve, CalibrationCurve)
    assert len(curve.points) == 5
    assert curve.brier_score >= 0.0
    assert curve.brier_skill_score <= 1.0


def test_bootstrap_confidence_intervals():
    samples = [{"val": i} for i in range(50)]

    def evaluator(sub):
        arr = [s["val"] for s in sub]
        return {"mean_val": float(sum(arr) / len(arr))} if arr else {"mean_val": 0.0}

    cis = bootstrap_confidence_intervals(samples, evaluator, n_resamples=100, ci_level=0.95, seed=42)
    assert "mean_val" in cis
    ci = cis["mean_val"]
    assert ci.ci_lower <= ci.point_estimate <= ci.ci_upper


def test_evaluation_run_serialization():
    run = EvaluationRun(
        id="run_test_123",
        created_at="2026-09-19T00:00:00Z",
        source_cohort="synthetic",
        split_id="synthetic-demo",
        config_hash="abc123hash",
        dataset_hash="def456hash",
        code_revision="git789rev",
        model_version="bocpd_neupert_v1",
        detection_metrics=DetectionMetrics(tp=10, fp=2, fn=1, tn=20, tss=0.7),
        lead_time_stats=LeadTimeStats(mean=12.5),
        horizon_brier_scores={5: 0.02, 10: 0.04},
        confidence_intervals={"tss": ConfidenceInterval("tss", 0.7, 0.6, 0.8)},
        calibration_curve=CalibrationCurve(points=[CalibrationPoint(0.5, 0.5, 0.5, 10)], brier_score=0.03),
        failure_slices={},
        sample_count=10,
    )

    d = run.to_dict()
    reconstructed = EvaluationRun.from_dict(d)

    assert reconstructed.id == run.id
    assert reconstructed.source_cohort == run.source_cohort
    assert reconstructed.config_hash == run.config_hash
    assert reconstructed.detection_metrics.tss == 0.7
    assert reconstructed.horizon_brier_scores[5] == 0.02


def test_db_evaluation_run_persistence():
    with TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test_suryakavach.db"
        conn = _sqlite_connect(db_path)

        run_dict = {
            "id": "eval_test_456",
            "created_at": "2026-09-19T10:00:00Z",
            "source_cohort": "synthetic",
            "split_id": "test-split",
            "config_hash": "hash_cfg",
            "dataset_hash": "hash_data",
            "code_revision": "rev1",
            "model_version": "v1",
            "detection_metrics": {"tss": 0.85},
            "sample_count": 5,
        }

        save_evaluation_run(conn, run_dict)
        retrieved = get_latest_evaluation_run(conn, source_cohort="synthetic")

        assert retrieved is not None
        assert retrieved["id"] == "eval_test_456"
        assert retrieved["source_cohort"] == "synthetic"
        assert retrieved["config_hash"] == "hash_cfg"

        conn.close()


def test_run_evaluation_execution():
    with TemporaryDirectory() as tmpdir:
        tmp_db = Path(tmpdir) / "eval_exec.db"
        eval_run = run_evaluation(
            source_cohort="synthetic",
            split_id="synthetic-demo",
            save_db=True,
            db_path=tmp_db,
        )

        assert isinstance(eval_run, EvaluationRun)
        assert eval_run.source_cohort == "synthetic"
        assert len(eval_run.config_hash) == 64  # SHA-256 hex string length
        assert len(eval_run.dataset_hash) == 64
        assert eval_run.sample_count > 0

        # Verify files generated
        assert Path("reports/metrics.md").exists()
        assert Path("reports/evaluation_latest.json").exists()

        md_content = Path("reports/metrics.md").read_text(encoding="utf-8")
        assert "# SURYAKAVACH Evaluation Report" in md_content
        assert eval_run.config_hash[:16] in md_content
