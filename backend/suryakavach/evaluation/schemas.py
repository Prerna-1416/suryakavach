from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class DetectionMetrics:
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0
    tss: float = 0.0
    hss: float = 0.0
    far: float = 0.0
    precision: float = 0.0
    recall: float = 0.0
    f1: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class LeadTimeStats:
    mean: float = 0.0
    median: float = 0.0
    std: float = 0.0
    p25: float = 0.0
    p75: float = 0.0
    min_val: float = 0.0
    max_val: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CalibrationPoint:
    bin_center: float
    prob_pred: float
    prob_true: float
    count: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CalibrationCurve:
    points: list[CalibrationPoint] = field(default_factory=list)
    brier_score: float = 0.0
    brier_skill_score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "points": [p.to_dict() for p in self.points],
            "brier_score": self.brier_score,
            "brier_skill_score": self.brier_skill_score,
        }


@dataclass
class FailureSliceMetrics:
    slice_name: str
    sample_count: int = 0
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0
    tss: float = 0.0
    hss: float = 0.0
    far: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ConfidenceInterval:
    metric_name: str
    point_estimate: float
    ci_lower: float
    ci_upper: float
    confidence_level: float = 0.95

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EvaluationRun:
    id: str
    created_at: str
    source_cohort: str  # 'synthetic' | 'observed_uncalibrated' | 'observed_calibrated'
    split_id: str
    config_hash: str
    dataset_hash: str
    code_revision: str
    model_version: str
    detection_metrics: DetectionMetrics
    lead_time_stats: LeadTimeStats
    horizon_brier_scores: dict[int, float]
    confidence_intervals: dict[str, ConfidenceInterval]
    calibration_curve: CalibrationCurve
    failure_slices: dict[str, FailureSliceMetrics]
    sample_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "created_at": self.created_at,
            "source_cohort": self.source_cohort,
            "split_id": self.split_id,
            "config_hash": self.config_hash,
            "dataset_hash": self.dataset_hash,
            "code_revision": self.code_revision,
            "model_version": self.model_version,
            "detection_metrics": self.detection_metrics.to_dict(),
            "lead_time_stats": self.lead_time_stats.to_dict(),
            "horizon_brier_scores": {str(k): v for k, v in self.horizon_brier_scores.items()},
            "confidence_intervals": {k: v.to_dict() for k, v in self.confidence_intervals.items()},
            "calibration_curve": self.calibration_curve.to_dict(),
            "failure_slices": {k: v.to_dict() for k, v in self.failure_slices.items()},
            "sample_count": self.sample_count,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvaluationRun:
        dm_raw = data.get("detection_metrics", {})
        detection_metrics = DetectionMetrics(**dm_raw)

        lt_raw = data.get("lead_time_stats", {})
        lead_time_stats = LeadTimeStats(**lt_raw)

        hb_raw = data.get("horizon_brier_scores", {})
        horizon_brier_scores = {int(k): float(v) for k, v in hb_raw.items()}

        ci_raw = data.get("confidence_intervals", {})
        confidence_intervals = {k: ConfidenceInterval(**v) for k, v in ci_raw.items()}

        cal_raw = data.get("calibration_curve", {})
        pts = [CalibrationPoint(**p) for p in cal_raw.get("points", [])]
        calibration_curve = CalibrationCurve(
            points=pts,
            brier_score=cal_raw.get("brier_score", 0.0),
            brier_skill_score=cal_raw.get("brier_skill_score", 0.0),
        )

        fs_raw = data.get("failure_slices", {})
        failure_slices = {k: FailureSliceMetrics(**v) for k, v in fs_raw.items()}

        return cls(
            id=data["id"],
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            source_cohort=data.get("source_cohort", "synthetic"),
            split_id=data.get("split_id", "synthetic-demo"),
            config_hash=data.get("config_hash", "unknown"),
            dataset_hash=data.get("dataset_hash", "unknown"),
            code_revision=data.get("code_revision", "unknown"),
            model_version=data.get("model_version", "bocpd_neupert_v1"),
            detection_metrics=detection_metrics,
            lead_time_stats=lead_time_stats,
            horizon_brier_scores=horizon_brier_scores,
            confidence_intervals=confidence_intervals,
            calibration_curve=calibration_curve,
            failure_slices=failure_slices,
            sample_count=data.get("sample_count", 0),
        )
