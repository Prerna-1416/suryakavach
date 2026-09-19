from __future__ import annotations

from suryakavach.evaluation.calibration import compute_calibration_curve
from suryakavach.evaluation.matching import EventMatchResult, match_events
from suryakavach.evaluation.metrics import (
    bootstrap_confidence_intervals,
    compute_brier_score,
    compute_detection_metrics,
    compute_lead_time_stats,
)
from suryakavach.evaluation.report import generate_markdown_report
from suryakavach.evaluation.schemas import (
    CalibrationCurve,
    CalibrationPoint,
    ConfidenceInterval,
    DetectionMetrics,
    EvaluationRun,
    FailureSliceMetrics,
    LeadTimeStats,
)

__all__ = [
    "compute_calibration_curve",
    "EventMatchResult",
    "match_events",
    "bootstrap_confidence_intervals",
    "compute_brier_score",
    "compute_detection_metrics",
    "compute_lead_time_stats",
    "generate_markdown_report",
    "CalibrationCurve",
    "CalibrationPoint",
    "ConfidenceInterval",
    "DetectionMetrics",
    "EvaluationRun",
    "FailureSliceMetrics",
    "LeadTimeStats",
]
