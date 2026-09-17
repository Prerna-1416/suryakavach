from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

from suryakavach.engines.bocpd import BOCPD
from suryakavach.engines.neupert import neupert_correlation
from suryakavach.goes import goes_class


@dataclass
class FlareEvent:
    id: str
    onset_idx: int
    peak_idx: int
    end_idx: int | None
    state: str
    peak_flux_sxr: float
    peak_flux_hxr: float
    hardness: float
    impulsivity: float
    integrated_flux: float
    class_label: str
    detection_method: str
    rejected: bool = False
    reject_reason: str | None = None
    index: float | None = None
    severity_band: str | None = None
    r_level: str | None = None
    posterior_at_onset: float = 0.0

    def duration_min(self) -> int:
        end = self.end_idx if self.end_idx is not None else self.peak_idx
        return max(end - self.onset_idx, 1)


@dataclass
class NowcastResult:
    posterior: NDArray[np.float64]
    events: list[FlareEvent]
    baseline_events: list[FlareEvent]
    state: str
    active: FlareEvent | None


def _new_id(n: int) -> str:
    return f"SK-{n:04d}"


def run_nowcast(
    sxr: NDArray[np.float64],
    hxr: NDArray[np.float64],
    cfg: dict[str, Any],
) -> NowcastResult:
    bocpd_cfg = cfg["bocpd"]
    neu_cfg = cfg["neupert"]
    baseline_thr = float(cfg["baseline"]["sxr_onset"])
    det = BOCPD(
        hazard=float(bocpd_cfg["hazard"]),
        max_run=int(bocpd_cfg["max_run"]),
        cp_window=int(bocpd_cfg.get("cp_window", 6)),
    )
    log_s = np.log10(np.clip(sxr, 1e-12, None))
    posterior = det.run(log_s)

    events: list[FlareEvent] = []
    active: FlareEvent | None = None
    n = 0
    cooldown = 0
    thresh = float(bocpd_cfg["threshold"])
    neu_min = float(neu_cfg["min_correlation"])
    neu_win = int(neu_cfg["window_min"])

    for i in range(1, len(sxr)):
        if cooldown > 0:
            cooldown -= 1
        cp = float(posterior[i])
        ds = sxr[i] - sxr[i - 1]
        jump = ds > 4.0 * max(np.std(sxr[max(0, i - 30) : i]) if i > 5 else 1e-10, 1e-12)

        if active is None and cooldown == 0 and (cp >= thresh or jump):
            sl = slice(max(0, i - neu_win), i + 1)
            neu = neupert_correlation(sxr[sl], hxr[sl], window=neu_win)
            if neu < neu_min and not jump:
                n += 1
                events.append(
                    FlareEvent(
                        id=_new_id(n),
                        onset_idx=i,
                        peak_idx=i,
                        end_idx=i,
                        state="rejected",
                        peak_flux_sxr=float(sxr[i]),
                        peak_flux_hxr=float(hxr[i]),
                        hardness=float(hxr[i] / max(sxr[i], 1e-12)),
                        impulsivity=0.0,
                        integrated_flux=0.0,
                        class_label=goes_class(float(sxr[i])),
                        detection_method="BOCPD",
                        rejected=True,
                        reject_reason=f"neupert_corr={neu:.2f}<{neu_min}",
                        posterior_at_onset=cp,
                    )
                )
                cooldown = 8
                continue
            n += 1
            method = "BOCPD" if cp >= thresh else "BOCPD+jump"
            active = FlareEvent(
                id=_new_id(n),
                onset_idx=i,
                peak_idx=i,
                end_idx=None,
                state="onset",
                peak_flux_sxr=float(sxr[i]),
                peak_flux_hxr=float(hxr[i]),
                hardness=0.0,
                impulsivity=0.0,
                integrated_flux=0.0,
                class_label=goes_class(float(sxr[i])),
                detection_method=method,
                posterior_at_onset=cp,
            )
            events.append(active)
            continue

        if active is not None:
            if sxr[i] >= active.peak_flux_sxr:
                active.peak_flux_sxr = float(sxr[i])
                active.peak_flux_hxr = float(hxr[i])
                active.peak_idx = i
                active.state = "rising"
            elif i - active.peak_idx <= 2:
                active.state = "peak"
            else:
                active.state = "decay"
            bg = float(np.median(sxr[max(0, active.onset_idx - 20) : active.onset_idx + 1]))
            if active.state in {"decay", "peak"} and sxr[i] <= bg * 1.8 and i - active.peak_idx >= 8:
                _finalize(active, sxr, hxr, i)
                active = None
                cooldown = 12

    if active is not None:
        _finalize(active, sxr, hxr, len(sxr) - 1)
        active.state = "decay"
        # keep as active if last point still elevated
        bg = float(np.median(sxr[max(0, active.onset_idx - 20) : active.onset_idx + 1]))
        if sxr[-1] > bg * 1.8:
            active.end_idx = None
        else:
            active.state = "end"

    baseline = _baseline_events(sxr, hxr, baseline_thr)
    confirmed = [e for e in events if not e.rejected]
    live_state = "quiet"
    live_active = None
    if confirmed:
        last = confirmed[-1]
        if last.end_idx is None or last.state not in {"end", "rejected"}:
            live_state = last.state
            live_active = last
        elif last.end_idx == len(sxr) - 1:
            live_state = last.state
            live_active = last
    return NowcastResult(
        posterior=posterior,
        events=confirmed,
        baseline_events=baseline,
        state=live_state if live_active else "quiet",
        active=live_active if live_active and live_active.end_idx is None else None,
    )


def _finalize(ev: FlareEvent, sxr: NDArray[np.float64], hxr: NDArray[np.float64], end: int) -> None:
    ev.end_idx = end
    ev.state = "end"
    sl = slice(ev.onset_idx, end + 1)
    ev.integrated_flux = float(np.trapezoid(sxr[sl], dx=60.0))
    dur = max(end - ev.onset_idx, 1)
    ev.hardness = float(ev.peak_flux_hxr / max(ev.peak_flux_sxr, 1e-12))
    ev.impulsivity = float(ev.peak_flux_sxr / max(dur, 1) * 1e6)
    ev.class_label = goes_class(ev.peak_flux_sxr)


def _baseline_events(sxr: NDArray[np.float64], hxr: NDArray[np.float64], thr: float) -> list[FlareEvent]:
    events: list[FlareEvent] = []
    in_ev = False
    start = 0
    peak_i = 0
    n = 0
    for i, v in enumerate(sxr):
        if not in_ev and v >= thr:
            in_ev = True
            start = i
            peak_i = i
        elif in_ev:
            if v > sxr[peak_i]:
                peak_i = i
            if v < thr * 0.6 and i - peak_i > 5:
                n += 1
                ev = FlareEvent(
                    id=f"BL-{n:04d}",
                    onset_idx=start,
                    peak_idx=peak_i,
                    end_idx=i,
                    state="end",
                    peak_flux_sxr=float(sxr[peak_i]),
                    peak_flux_hxr=float(hxr[peak_i]),
                    hardness=float(hxr[peak_i] / max(sxr[peak_i], 1e-12)),
                    impulsivity=float(sxr[peak_i] / max(i - start, 1) * 1e6),
                    integrated_flux=float(np.trapezoid(sxr[start : i + 1], dx=60.0)),
                    class_label=goes_class(float(sxr[peak_i])),
                    detection_method="threshold",
                )
                events.append(ev)
                in_ev = False
    return events
