from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

from suryakavach.engines.forecast import FEATURE_NAMES, rolling_features, vectorize


@dataclass
class SurvivalBatch:
    sequences: NDArray[np.float64]  # Shape: (batch_size, seq_len, num_features)
    c_event: NDArray[np.float64]     # Shape: (batch_size,) - 1.0 if C1+ flare occurred, else 0.0
    c_time: NDArray[np.int64]        # Shape: (batch_size,) - minute of event or censoring (1..max_horizon)
    m_event: NDArray[np.float64]     # Shape: (batch_size,) - 1.0 if M1+ flare occurred, else 0.0
    m_time: NDArray[np.int64]        # Shape: (batch_size,) - minute of event or censoring (1..max_horizon)


def extract_day_windows(
    day_data: dict[str, Any],
    seq_len: int = 60,
    max_horizon: int = 40,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.int64], NDArray[np.float64], NDArray[np.int64]]:
    """Extracts causal sequence windows and discrete time-to-event targets for a single day.

    Guarantees no future feature leakage: features at time t use only observations <= t.
    """
    sxr = day_data["solexs"]
    hxr = day_data["hel1os"]
    truth = day_data.get("truth", [])
    n = len(sxr)

    # Pre-extract onset indices for C1+ (flux >= 1e-6) and M1+ (flux >= 1e-5)
    t0 = day_data.get("t0")
    c_onsets = []
    m_onsets = []
    for fl in truth:
        o = int((fl.onset - t0).total_seconds() // 60) if t0 and hasattr(fl, "onset") else getattr(fl, "onset_idx", 0)
        peak_flux = getattr(fl, "peak_sxr", getattr(fl, "peak_flux_sxr", 0.0))
        if peak_flux >= 1e-6:
            c_onsets.append(o)
        if peak_flux >= 1e-5:
            m_onsets.append(o)

    # Precompute one vectorized feature per minute before the window loop
    per_minute = []
    last_flare_idx = None
    for step in range(n):
        if step in c_onsets:
            last_flare_idx = step
        step_sxr = sxr[: step + 1]
        step_hxr = hxr[: step + 1]
        fdict = rolling_features(step_sxr, step_hxr, window=min(60, len(step_sxr)), last_flare_idx=last_flare_idx)
        per_minute.append(vectorize(fdict))

    per_minute_arr = np.array(per_minute, dtype=np.float64)

    seqs = []
    c_events = []
    c_times = []
    m_events = []
    m_times = []

    for t in range(seq_len, n - max_horizon):
        feat_window = per_minute_arr[t - seq_len : t]
        seqs.append(feat_window)

        # Check C1+ event in (t, t + max_horizon]
        future_c = [o for o in c_onsets if t < o <= t + max_horizon]
        if future_c:
            c_events.append(1.0)
            c_times.append(min(future_c) - t)
        else:
            c_events.append(0.0)
            c_times.append(max_horizon)

        # Check M1+ event in (t, t + max_horizon]
        future_m = [o for o in m_onsets if t < o <= t + max_horizon]
        if future_m:
            m_events.append(1.0)
            m_times.append(min(future_m) - t)
        else:
            m_events.append(0.0)
            m_times.append(max_horizon)

    if not seqs:
        num_feats = len(FEATURE_NAMES)
        return (
            np.zeros((0, seq_len, num_feats), dtype=np.float64),
            np.zeros(0, dtype=np.float64),
            np.zeros(0, dtype=np.int64),
            np.zeros(0, dtype=np.float64),
            np.zeros(0, dtype=np.int64),
        )

    return (
        np.array(seqs, dtype=np.float64),
        np.array(c_events, dtype=np.float64),
        np.array(c_times, dtype=np.int64),
        np.array(m_events, dtype=np.float64),
        np.array(m_times, dtype=np.int64),
    )


def create_survival_dataset(
    days_data: dict[str, Any],
    split: str = "train",
    seq_len: int = 60,
    max_horizon: int = 40,
) -> SurvivalBatch:
    """Combines sequence windows across dataset days based on split partitions."""
    keys = sorted(days_data.keys())
    n = len(keys)

    i1 = int(n * 0.6)
    i2 = int(n * 0.8)
    i3 = int(n * 0.9)

    if split == "train":
        target_keys = keys[:i1]
    elif split in ("val", "validation"):
        target_keys = keys[i1:i2]
    elif split == "calibration":
        target_keys = keys[i2:i3]
    else:  # holdout
        target_keys = keys[i3:]

    all_seqs = []
    all_ce = []
    all_ct = []
    all_me = []
    all_mt = []

    for k in target_keys:
        seqs, ce, ct, me, mt = extract_day_windows(days_data[k], seq_len=seq_len, max_horizon=max_horizon)
        if len(seqs) > 0:
            all_seqs.append(seqs)
            all_ce.append(ce)
            all_ct.append(ct)
            all_me.append(me)
            all_mt.append(mt)

    if not all_seqs:
        num_feats = len(FEATURE_NAMES)
        return SurvivalBatch(
            sequences=np.zeros((0, seq_len, num_feats), dtype=np.float64),
            c_event=np.zeros(0, dtype=np.float64),
            c_time=np.zeros(0, dtype=np.int64),
            m_event=np.zeros(0, dtype=np.float64),
            m_time=np.zeros(0, dtype=np.int64),
        )

    return SurvivalBatch(
        sequences=np.concatenate(all_seqs, axis=0),
        c_event=np.concatenate(all_ce, axis=0),
        c_time=np.concatenate(all_ct, axis=0),
        m_event=np.concatenate(all_me, axis=0),
        m_time=np.concatenate(all_mt, axis=0),
    )
