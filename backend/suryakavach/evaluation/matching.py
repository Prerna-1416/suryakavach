from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class EventMatchResult:
    matched_pairs: list[dict[str, Any]] = field(default_factory=list)
    false_alarms: list[dict[str, Any]] = field(default_factory=list)
    misses: list[dict[str, Any]] = field(default_factory=list)
    lead_times: list[float] = field(default_factory=list)
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0


def match_events(
    predicted_events: list[dict[str, Any]],
    ground_truth_events: list[dict[str, Any]],
    match_window_min: int = 15,
    total_quiet_windows: int = 0,
) -> EventMatchResult:
    """Matches predicted flare events with ground-truth reference flares.

    A predicted event is matched if its onset index falls within
    ``abs(pred_onset - truth_onset) <= match_window_min``.

    Lead time is defined as ``truth_peak_idx - pred_onset_idx`` (in minutes).
    """
    matched_truth = set()
    matched_pairs = []
    false_alarms = []
    lead_times = []

    for pred in predicted_events:
        pred_onset = pred.get("onset_idx", 0)
        hit_idx = None
        for j, truth in enumerate(ground_truth_events):
            if j in matched_truth:
                continue
            truth_onset = truth.get("onset_idx", 0)
            if abs(pred_onset - truth_onset) <= match_window_min:
                hit_idx = j
                truth_peak = truth.get("peak_idx", truth_onset)
                lead_min = float(truth_peak - pred_onset)
                lead_times.append(lead_min)
                matched_pairs.append({
                    "prediction": pred,
                    "truth": truth,
                    "lead_time_min": lead_min,
                })
                break
        if hit_idx is not None:
            matched_truth.add(hit_idx)
        else:
            false_alarms.append(pred)

    misses = [truth for j, truth in enumerate(ground_truth_events) if j not in matched_truth]

    tp = len(matched_pairs)
    fp = len(false_alarms)
    fn = len(misses)
    # Ensure TN is non-negative
    tn = max(0, total_quiet_windows - (tp + fp + fn))

    return EventMatchResult(
        matched_pairs=matched_pairs,
        false_alarms=false_alarms,
        misses=misses,
        lead_times=lead_times,
        tp=tp,
        fp=fp,
        fn=fn,
        tn=tn,
    )
