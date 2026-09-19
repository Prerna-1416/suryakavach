from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
import threading
import uuid
from dataclasses import replace
from typing import Any

import numpy as np

from suryakavach.config import data_dir, load_config
from suryakavach.db import connect
from suryakavach.engines.calibration import FluxCalibration
from suryakavach.engines.evt import intensity_quantiles
from suryakavach.engines.forecast import DiscreteHazard, rolling_features
from suryakavach.engines.impact import compute_impact, map_severity
from suryakavach.engines.nowcast import FlareEvent, run_nowcast
from suryakavach.goes import class_meets_min, goes_class, iso
from suryakavach.ingest.pradan import load_real_day_files
from suryakavach.ingest.synthetic import build_all_days

UTC = timezone.utc


def _ffill(x: np.ndarray, default: float = 1e-12) -> np.ndarray:
    """Forward-fill non-finite samples, seeding from a fixed finite floor.

    Real product files can contain both missing values and overflow sentinels.
    An all-non-finite input would otherwise propagate NaN/inf through the
    detectors; fall back to a tiny positive floor so log/ratio maths and the
    BOCPD finite-input contract remain valid.
    """
    y = np.asarray(x, dtype=float).copy()
    if y.size == 0:
        return y
    finite = np.isfinite(y)
    if not np.any(finite):
        return np.full_like(y, default)
    last = default
    for i in range(len(y)):
        if not np.isfinite(y[i]):
            y[i] = last
        else:
            last = y[i]
    return y


MINUTES_PER_DAY = 1440
LAST_IDX = MINUTES_PER_DAY - 1

# Cap on rows kept in the alerts table. tick() can emit several alerts per
# minute of replay, so an unbounded table grows without limit over a long run.
MAX_ALERTS = 2000


class Runtime:
    def __init__(self, boot: bool = True) -> None:
        self.cfg = load_config()
        self.data_path = data_dir(self.cfg)
        self.conn = connect(self.data_path / "suryakavach.sqlite")
        self.lock = threading.RLock()
        self.ws_clients: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.mode = "simulated"
        self.playing = False
        self.speed = float(self.cfg["replay"]["default_speed"])
        # Set whenever speed changes so the sim loop can abandon a long sleep
        # and re-derive its tick interval immediately.
        self.speed_changed = asyncio.Event()
        self.event_date = str(self.cfg["replay"]["default_event"])
        self.cursor = 0
        self.session_id: int | None = None
        self.hazard = DiscreteHazard()
        self.days: dict[str, dict] = {}
        self.nowcast_by_day: dict[str, Any] = {}
        self.engine_status = {
            "nowcast": "starting",
            "forecast": "starting",
            "impact": "starting",
        }
        self.last_tick = datetime.now(UTC)
        self._alerts_since_prune = 0
        # (type, flare_id, message) of the last alert, used to suppress the same
        # alert repeating on every tick.
        self._last_alert_key: tuple | None = None
        self._forecast_high_latched = False
        self._gap_latched = False
        self.booted = False
        self.boot_error: str | None = None
        if boot:
            self.boot()

    def boot(self) -> None:
        """Build the synthetic cache and fit the engines.

        Kept separate from ``__init__`` so importing this module has no heavy
        side effects and the API can run boot off the event loop at startup.
        Failures are recorded in ``engine_status`` rather than raised, so
        ``/api/health`` can report a degraded service instead of the process
        dying before it binds a port.
        """
        if self.booted:
            return
        try:
            self.days = self._build_preferred_days()
            self._fit_forecast()
            self._run_all_nowcasts()
            self._persist_flares()
            self.engine_status = {k: "ok" for k in self.engine_status}
        except Exception as exc:  # pragma: no cover - defensive boot guard
            self.boot_error = f"{type(exc).__name__}: {exc}"
            self.engine_status = {k: "error" for k in self.engine_status}
            raise
        finally:
            self.booted = True
        # Default demo: 2024-02-22 at 21:00 so onset (22:08) arrives quickly at 20×
        default_event = str(self.cfg["replay"]["default_event"])
        self.event_date = default_event if default_event in self.days else self.available_dates()[0]
        self.cursor = min(21 * 60, len(self.day()["ts"]) - 1)
        self.playing = True
        self.speed = float(self.cfg["replay"]["default_speed"])

    def _build_preferred_days(self) -> dict[str, dict]:
        days = build_all_days(int(self.cfg["data"]["seed"]))
        for synthetic_day in days.values():
            synthetic_day["source_state"] = "synthetic"
            synthetic_day["provenance"] = {"generator": "synthetic"}

        # Real product files must not silently replace the labelled synthetic
        # replay set.  L1 count-rate products are useful diagnostics, but are
        # not calibrated physical flux and contain no ground-truth flare
        # labels.  An explicitly calibrated, labelled import can be enabled
        # only after it satisfies both contracts.
        if self.cfg["data"].get("source_state") != "observed_calibrated":
            return days
        real_root = self.data_path / "real_days"
        if not real_root.is_dir():
            return days

        for src_dir in real_root.iterdir():
            if not src_dir.is_dir():
                continue
            day = src_dir.name
            try:
                real_day = load_real_day_files(day, src_dir)
            except (FileNotFoundError, OSError, ValueError):
                continue
            if not real_day.get("truth"):
                continue

            cal_file = src_dir / "calibration.json"
            if not cal_file.exists():
                cal_file = self.data_path / "calibration.json"
            if cal_file.exists():
                try:
                    cal_data = json.loads(cal_file.read_text(encoding="utf-8"))
                    cal = FluxCalibration(
                        calibration_id=cal_data["calibration_id"],
                        intercept=float(cal_data["intercept"]),
                        slope=float(cal_data["slope"]),
                        rmse_log10=float(cal_data.get("rmse_log10", 0.1)),
                        sample_count=int(cal_data.get("sample_count", 100)),
                        dataset_provenance=str(cal_data.get("dataset_provenance", "reference_goes_xrs")),
                    )
                    real_day["solexs"] = cal.apply(real_day["solexs"])
                    real_day["source_state"] = "observed_calibrated"
                    real_day["provenance"] = {
                        "source": "real_days",
                        "calibration_id": cal.calibration_id,
                        "calibration": cal.metadata(),
                    }
                    days[day] = real_day
                except Exception:
                    real_day["source_state"] = "observed_uncalibrated"
                    real_day["provenance"] = {"source": "real_days", "calibration": "invalid"}
                    days[day] = real_day
            else:
                real_day["source_state"] = "observed_uncalibrated"
                real_day["provenance"] = {"source": "real_days", "calibration": "missing"}
                days[day] = real_day
        return days

    def _fit_forecast(self) -> None:
        xs = []
        yc = []
        ym = []
        for day in self.days.values():
            if day.get("source_state") not in {"synthetic", "observed_calibrated"} or not day.get("truth"):
                continue
            sxr = _ffill(day["solexs"])
            hxr = _ffill(day["hel1os"])
            onsets = [int((fl.onset - day["t0"]).total_seconds() // 60) for fl in day["truth"]]
            m_onsets = [
                int((fl.onset - day["t0"]).total_seconds() // 60)
                for fl in day["truth"]
                if fl.peak_sxr >= 1e-5
            ]
            for i in range(60, len(sxr), 5):
                last = max([o for o in onsets if o < i], default=None)
                feat = rolling_features(sxr[: i + 1], hxr[: i + 1], last_flare_idx=last)
                xs.append(feat)
                yc.append(1.0 if any(i < o <= i + 20 for o in onsets) else 0.0)
                ym.append(1.0 if any(i < o <= i + 20 for o in m_onsets) else 0.0)
        from suryakavach.engines.forecast import vectorize

        X = np.array([vectorize(row) if isinstance(row, dict) else row for row in xs], dtype=float)
        if len(X) == 0:
            raise RuntimeError("no labelled calibrated days are available to fit the forecast")
        self.hazard.fit(X, np.array(yc), np.array(ym))

    def _run_all_nowcasts(self) -> None:
        for key, day in self.days.items():
            sxr = _ffill(day["solexs"])
            hxr = _ffill(day["hel1os"])
            nc = run_nowcast(sxr, hxr, self.cfg)
            for ev in nc.events:
                ev.id = f"{key}-{ev.id}"
            for ev in nc.baseline_events:
                ev.id = f"{key}-{ev.id}"
            self.nowcast_by_day[key] = nc
            peaks = [e.peak_flux_sxr for e in nc.events]
            day["evt"] = intensity_quantiles(peaks)

    def _persist_flares(self) -> None:
        self.conn.execute("DELETE FROM flares")
        # Under Supabase each upsert is an HTTP round-trip; buffer them into a
        # few bulk requests instead of ~115 sequential calls at boot.
        batch = getattr(self.conn, "batch_flares", None)
        if batch:
            batch()
        n = 0
        for key, nc in self.nowcast_by_day.items():
            day = self.days[key]
            ts = day["ts"]
            for ev in nc.events + nc.baseline_events:
                n += 1
                dur = ev.duration_min()
                impact = compute_impact(
                    ev.peak_flux_sxr,
                    ev.hardness,
                    ev.impulsivity,
                    dur,
                    self.cfg["impact"]["weights"],
                    self.cfg["impact"]["suit_available"],
                )
                sev = map_severity(impact["index"], self.cfg["severity_bands"])
                ev.index = impact["index"]
                ev.severity_band = sev["band"]
                ev.r_level = sev["r_level"]
                end_ts = iso(ts[ev.end_idx]) if ev.end_idx is not None else None
                self.conn.execute(
                    """INSERT OR REPLACE INTO flares
                    (id, onset, peak, end, class, peak_flux_sxr, peak_flux_hxr, hardness,
                     impulsivity, integrated_flux, impact_index, severity_band, r_level,
                     detection_method, onset_idx, peak_idx, end_idx, posterior)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        ev.id if ev.detection_method != "threshold" else ev.id,
                        iso(ts[ev.onset_idx]),
                        iso(ts[ev.peak_idx]),
                        end_ts,
                        ev.class_label,
                        ev.peak_flux_sxr,
                        ev.peak_flux_hxr,
                        ev.hardness,
                        ev.impulsivity,
                        ev.integrated_flux,
                        ev.index,
                        ev.severity_band,
                        ev.r_level,
                        ev.detection_method,
                        ev.onset_idx,
                        ev.peak_idx,
                        ev.end_idx,
                        ev.posterior_at_onset,
                    ),
                )
        flush = getattr(self.conn, "flush_flares", None)
        if flush:
            flush()
        self.conn.commit()

    def available_dates(self) -> list[str]:
        return sorted(self.days.keys())

    def source_state(self) -> str:
        """State of the current replay data, never inferred from a filename."""
        return str(self.day().get("source_state", "synthetic"))

    def impact_scale(self) -> dict:
        """The sole API contract for impact bands and configured weights."""
        lower = 0.0
        bands = []
        for source in self.cfg["severity_bands"]:
            upper = float(source["max"])
            bands.append(
                {
                    "min": lower,
                    "max": upper,
                    "band": str(source["band"]),
                    "r_level": str(source["r_level"]),
                    "color": str(source.get("color", "#93a0b6")),
                }
            )
            lower = upper
        weights = compute_impact(
            0.0, 0.0, 0.0, 1.0, self.cfg["impact"]["weights"], self.cfg["impact"]["suit_available"]
        )["weights_used"]
        state = self.source_state()
        return {
            "version": str(self.cfg.get("impact_scale", {}).get("version", "unversioned")),
            "bands": bands,
            "weights": weights,
            "source_state": state,
            "operational": state == "observed_calibrated",
        }

    def day(self) -> dict:
        try:
            return self.days[self.event_date]
        except KeyError:
            if not self.days:
                raise RuntimeError("runtime not booted: no cached days available") from None
            # event_date drifted out of the cache; fall back rather than 500.
            self.event_date = self.available_dates()[0]
            return self.days[self.event_date]

    def _cursor_iso(self) -> str | None:
        if not self.days:
            return None
        return iso(self.day()["ts"][self._clamp_cursor(self.cursor)])

    def envelope(self, data: Any, extra_meta: dict | None = None) -> dict:
        meta = {
            "timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "mode": self.mode,
            "event_date": self.event_date,
            "cursor": self._cursor_iso(),
        }
        if extra_meta:
            meta.update(extra_meta)
        return {"data": data, "meta": meta}

    def health(self) -> dict:
        engines = dict(self.engine_status)
        ok = self.booted and all(v == "ok" for v in engines.values())
        out = {
            "status": "ok" if ok else "degraded",
            "data_last_timestamp": self._cursor_iso(),
            "source_state": self.source_state() if self.days else None,
            "engines": engines,
            "mode": self.mode,
            "playing": self.playing,
            "speed": self.speed,
        }
        if self.boot_error:
            out["error"] = self.boot_error
        return out

    def streams_latest(self, window: int = 120) -> dict:
        day = self.day()
        i0 = max(0, self.cursor - window + 1)
        sl = slice(i0, self.cursor + 1)
        nc = self._nowcast_until(self.cursor)
        shades = []
        for ev in nc.events:
            if ev.onset_idx > self.cursor:
                continue
            end = min(ev.end_idx if ev.end_idx is not None else self.cursor, self.cursor)
            if end < i0:
                continue
            shades.append(
                {
                    "start": iso(day["ts"][ev.onset_idx]),
                    "end": iso(day["ts"][end]),
                    "class": ev.class_label,
                }
            )
        cps = []
        post = nc.posterior[: self.cursor + 1]
        for j in range(i0, self.cursor + 1):
            if post[j] >= float(self.cfg["bocpd"]["threshold"]):
                cps.append({"t": iso(day["ts"][j]), "p": round(float(post[j]), 3)})
        q = day["quality"][sl]
        gaps = []
        in_gap = False
        g0 = 0
        for gi in range(i0, self.cursor + 1):
            if day["quality"][gi] == 0 and not in_gap:
                in_gap = True
                g0 = gi
            elif day["quality"][gi] != 0 and in_gap:
                gaps.append({"start": iso(day["ts"][g0]), "end": iso(day["ts"][gi - 1])})
                in_gap = False
        if in_gap:
            # A gap still open at the cursor must be reported, otherwise the UI
            # shows no gap marker for exactly the window an operator is looking
            # at while data is missing.
            gaps.append({"start": iso(day["ts"][g0]), "end": iso(day["ts"][self.cursor])})
        return {
            "solexs": [
                {"t": iso(t), "v": None if np.isnan(v) else float(v)}
                for t, v in zip(day["ts"][sl], day["solexs"][sl])
            ],
            "hel1os": [
                {"t": iso(t), "v": None if np.isnan(v) else float(v)}
                for t, v in zip(day["ts"][sl], day["hel1os"][sl])
            ],
            "quality": [int(x) for x in q],
            "flare_intervals": shades,
            "changepoints": cps,
            "gaps": gaps,
        }

    def _nowcast_until(self, idx: int):
        """Causal slice of the day nowcast (BOCPD update is online; no future leakage)."""
        full = self.nowcast_by_day[self.event_date]
        events = []
        for ev in full.events:
            if ev.onset_idx > idx:
                continue
            clone = replace(ev)
            if clone.peak_idx > idx:
                clone.peak_idx = idx
                clone.state = "rising"
                clone.end_idx = None
            elif clone.end_idx is None or clone.end_idx > idx:
                if idx - clone.peak_idx <= 2:
                    clone.state = "peak"
                else:
                    clone.state = "decay"
                clone.end_idx = None
            events.append(clone)
        baseline = [e for e in full.baseline_events if e.onset_idx <= idx]
        active = events[-1] if events and events[-1].end_idx is None else None
        state = active.state if active else "quiet"
        out = type(full)(
            posterior=full.posterior[: idx + 1],
            events=events,
            baseline_events=baseline,
            state=state,
            active=active,
        )
        return out

    def nowcast_state(self) -> dict:
        nc = self._nowcast_until(self.cursor)
        active = None
        if nc.events:
            last = nc.events[-1]
            if last.end_idx is None or last.end_idx >= self.cursor - 2:
                if last.onset_idx <= self.cursor:
                    active = self._flare_public(last, prefix=True)
        return {
            "state": nc.state if active else "quiet",
            "active": active,
            "threshold_baseline_active": bool(
                nc.baseline_events
                and nc.baseline_events[-1].onset_idx <= self.cursor
                and (nc.baseline_events[-1].end_idx is None or nc.baseline_events[-1].end_idx >= self.cursor)
            ),
        }

    def _flare_public(self, ev: FlareEvent, prefix: bool = False) -> dict:
        """Serialise a flare for the live API.

        With ``prefix=True`` every derived quantity is recomputed from the data
        up to ``self.cursor``. Reading them off the event object would leak the
        whole-day result: mid-rise, an X6.3 would already report its final peak
        flux, class and impact index, which is exactly what an early-warning
        demo must not do.
        """
        day = self.day()
        ts = day["ts"]
        end_idx = ev.end_idx
        if not prefix:
            peak_idx = ev.peak_idx
            peak_sxr, peak_hxr = ev.peak_flux_sxr, ev.peak_flux_hxr
            hardness, impulsivity = ev.hardness, ev.impulsivity
            integrated, index = ev.integrated_flux, ev.index
            band, r_level = ev.severity_band, ev.r_level
            class_label = ev.class_label
        else:
            i0, i1 = ev.onset_idx, max(ev.onset_idx, self.cursor)
            sxr = _ffill(day["solexs"][i0 : i1 + 1])
            hxr = _ffill(day["hel1os"][i0 : i1 + 1])
            peak_idx = i0 + int(np.argmax(sxr))
            peak_sxr = float(sxr[peak_idx - i0])
            peak_hxr = float(np.max(hxr))
            dur = max(i1 - i0, 1)
            hardness = peak_hxr / max(peak_sxr, 1e-12)
            impulsivity = peak_sxr / dur * 1e6
            integrated = float(np.trapezoid(sxr, dx=60.0))
            imp = compute_impact(
                peak_sxr,
                hardness,
                impulsivity,
                dur,
                self.cfg["impact"]["weights"],
                self.cfg["impact"]["suit_available"],
            )
            sev = map_severity(imp["index"], self.cfg["severity_bands"])
            index, band, r_level = imp["index"], sev["band"], sev["r_level"]
            class_label = goes_class(peak_sxr)
        return {
            "id": ev.id,
            "onset": iso(ts[ev.onset_idx]),
            "peak": iso(ts[peak_idx]),
            "end": iso(ts[end_idx]) if end_idx is not None and (not prefix or end_idx <= self.cursor) else None,
            "state": ev.state,
            "class": class_label,
            "peak_flux_sxr": peak_sxr,
            "peak_flux_hxr": peak_hxr,
            "hardness": hardness,
            "impulsivity": impulsivity,
            "integrated_flux": integrated,
            "index": index,
            "severity_band": band,
            "r_level": r_level,
            "detection_method": ev.detection_method,
            "posterior": ev.posterior_at_onset,
        }

    def forecast_horizons(self) -> dict:
        day = self.day()
        i = self.cursor
        sxr = _ffill(day["solexs"][: i + 1])
        hxr = _ffill(day["hel1os"][: i + 1])
        nc = self._nowcast_until(i)
        last = nc.events[-1].onset_idx if nc.events else None
        feat = rolling_features(sxr, hxr, last_flare_idx=last)
        pred = self.hazard.predict(feat, list(self.cfg["horizons"]))
        evt = day.get("evt") or intensity_quantiles(
            [e.peak_flux_sxr for e in self.nowcast_by_day[self.event_date].events]
        )
        for h in pred["horizons"]:
            h["q50"] = evt["q50"]
            h["q90"] = evt["q90"]
            h["q99"] = evt["q99"]
        return pred

    def impact_current(self) -> dict:
        if self.source_state() == "observed_uncalibrated" and self.cfg["calibration"].get(
            "require_calibrated_flux_for_impact", True
        ):
            return {
                "index": None,
                "band": "UNAVAILABLE",
                "r_level": "—",
                "g_level": "—",
                "s_level": "—",
                "subscores": {},
                "weights_used": {},
                "note": "Impact is unavailable: observed count-rate data has no approved flux calibration.",
            }
        nc = self._nowcast_until(self.cursor)
        if not nc.events:
            empty = compute_impact(
                1e-8, 0.1, 0.0, 1, self.cfg["impact"]["weights"], self.cfg["impact"]["suit_available"]
            )
            sev = map_severity(empty["index"], self.cfg["severity_bands"])
            return {
                "index": empty["index"],
                "band": sev["band"],
                "r_level": sev["r_level"],
                "g_level": "G0",
                "s_level": "S0",
                "subscores": empty["subscores"],
                "weights_used": empty["weights_used"],
                "note": "No active/recent flare in window.",
            }
        ev = nc.events[-1]
        # `ev.end_idx or self.cursor` would treat a legitimate end_idx of 0 as
        # missing; compare against None explicitly.
        end = self.cursor if ev.end_idx is None else min(self.cursor, ev.end_idx)
        dur = max(end - ev.onset_idx, 1)
        hi = max(ev.onset_idx, self.cursor)
        peak = float(np.max(_ffill(self.day()["solexs"][ev.onset_idx : hi + 1])))
        hxr_peak = float(np.max(_ffill(self.day()["hel1os"][ev.onset_idx : hi + 1])))
        hardness = hxr_peak / max(peak, 1e-12)
        impulsivity = peak / dur * 1e6
        impact = compute_impact(
            peak,
            hardness,
            impulsivity,
            dur,
            self.cfg["impact"]["weights"],
            self.cfg["impact"]["suit_available"],
        )
        sev = map_severity(impact["index"], self.cfg["severity_bands"])
        return {
            "index": impact["index"],
            "band": sev["band"],
            "r_level": sev["r_level"],
            "g_level": "G0",
            "s_level": "S0",
            "subscores": impact["subscores"],
            "weights_used": impact["weights_used"],
            "flare_id": ev.id,
            "note": "SUIT NUV unavailable in v1 cache; weight renormalized.",
        }

    def catalogue(self, frm: str | None, to: str | None, min_class: str, page: int, size: int, method: str | None):
        q = "SELECT * FROM flares WHERE 1=1"
        args: list[Any] = []
        if frm:
            q += " AND onset >= ?"
            args.append(frm if "T" in frm else frm + "T00:00:00Z")
        if to:
            q += " AND onset <= ?"
            args.append(to if "T" in to else to + "T23:59:59Z")
        if method:
            q += " AND detection_method = ?"
            args.append(method)
        q += " ORDER BY onset DESC"
        rows = [dict(r) for r in self.conn.execute(q, args).fetchall()]
        rows = [r for r in rows if class_meets_min(r["class"], min_class)]
        total = len(rows)
        # Clamp rather than trust: page=0 or a negative page would otherwise
        # produce a negative slice start and silently return the wrong window
        # (page=0 returned an empty list even though results existed).
        page = max(1, int(page))
        size = max(1, min(int(size), 500))
        pages = max(1, (total + size - 1) // size)
        page = min(page, pages)
        start = (page - 1) * size
        chunk = rows[start : start + size]
        return {
            "items": chunk,
            "page": page,
            "page_size": size,
            "total": total,
            "pages": pages,
        }

    def flare_detail(self, fid: str) -> dict | None:
        row = self.conn.execute("SELECT * FROM flares WHERE id = ?", (fid,)).fetchone()
        if not row:
            return None
        rec = dict(row)
        date = rec["onset"][:10]
        day = self.days.get(date)
        if not day:
            return rec
        o, p = int(rec["onset_idx"]), int(rec["peak_idx"])
        # end_idx may legitimately be 0 or NULL; `or` would conflate the two.
        e = int(rec["end_idx"]) if rec["end_idx"] is not None else p
        last = len(day["ts"]) - 1
        o = max(0, min(o, last))
        p = max(0, min(p, last))
        e = max(0, min(e, last))
        i0, i1 = max(0, o - 30), min(last, e + 30)
        nc = self.nowcast_by_day[date]
        rec["series"] = {
            "solexs": [
                {"t": iso(day["ts"][i]), "v": float(day["solexs"][i]) if not np.isnan(day["solexs"][i]) else None}
                for i in range(i0, i1 + 1)
            ],
            "hel1os": [
                {"t": iso(day["ts"][i]), "v": float(day["hel1os"][i]) if not np.isnan(day["hel1os"][i]) else None}
                for i in range(i0, i1 + 1)
            ],
            "posterior": [
                {"t": iso(day["ts"][i]), "v": float(nc.posterior[i])} for i in range(i0, min(i1, len(nc.posterior) - 1) + 1)
            ],
        }
        impact = compute_impact(
            rec["peak_flux_sxr"],
            rec["hardness"],
            rec["impulsivity"],
            max(e - o, 1),
            self.cfg["impact"]["weights"],
            self.cfg["impact"]["suit_available"],
        )
        rec["subscores"] = impact["subscores"]
        post = rec.get("posterior")
        post_txt = f"{float(post):.2f}" if post is not None else "n/a"
        rec["confidence"] = (
            f"Changepoint posterior at onset {post_txt}. Neupert gate applied. "
            "Index uses hand-tuned weights (SUIT term dropped)."
        )
        return rec

    def alerts(self, since: str | None) -> list[dict]:
        q = "SELECT * FROM alerts"
        args: list[Any] = []
        if since:
            q += " WHERE ts >= ?"
            args.append(since)
        q += " ORDER BY id DESC LIMIT 100"
        return [dict(r) for r in self.conn.execute(q, args).fetchall()]

    def _emit_alert(self, typ: str, severity: str, flare_id: str | None, message: str, ts: str) -> None:
        self.conn.execute(
            "INSERT INTO alerts (ts, type, severity, flare_id, message) VALUES (?,?,?,?,?)",
            (ts, typ, severity, flare_id, message),
        )
        self.conn.commit()
        self._alerts_since_prune += 1
        if self._alerts_since_prune >= 200:
            self._alerts_since_prune = 0
            self._prune_alerts()

    def _prune_alerts(self) -> None:
        """Keep the alerts table bounded.

        tick() can emit several alerts per replay minute, so over a long session
        the table grows without limit and `SELECT ... LIMIT 100` scans get slower
        while the sqlite file keeps growing.
        """
        try:
            self.conn.execute(
                "DELETE FROM alerts WHERE id NOT IN "
                "(SELECT id FROM alerts ORDER BY id DESC LIMIT ?)",
                (MAX_ALERTS,),
            )
            self.conn.commit()
        except Exception:
            # Pruning is housekeeping; never let it break a tick. The Supabase
            # shim has no pattern for this statement and will raise ValueError.
            pass

    def start_replay(self, event_date: str, speed: float) -> dict:
        if event_date not in self.days:
            raise ValueError(f"No cached day {event_date}")
        with self.lock:
            self.event_date = event_date
            self.speed = float(speed)
            self.mode = "simulated"
            self.playing = True
            # Start 3h before first truth flare, or 00:00
            truth = self.days[event_date].get("truth") or []
            if truth:
                t0 = self.days[event_date]["t0"]
                first = min(fl.onset for fl in truth)
                start = first - timedelta(hours=3)
                idx = int((start - t0).total_seconds() // 60)
                self.cursor = self._clamp_cursor(idx)
            else:
                self.cursor = 0
            self._gap_latched = False
            self._forecast_high_latched = False
            cur = self.conn.execute(
                "INSERT INTO replay_sessions (event_date, speed, status, cursor) VALUES (?,?,?,?)",
                (event_date, self.speed, "running", iso(self.day()["ts"][self.cursor])),
            )
            self.session_id = cur.lastrowid
            self.conn.commit()
        return {"session_id": self.session_id, "event_date": event_date, "speed": self.speed, "cursor": iso(self.day()["ts"][self.cursor])}

    def stop_replay(self) -> dict:
        with self.lock:
            self.playing = False
            if self.session_id:
                self.conn.execute(
                    "UPDATE replay_sessions SET status=?, cursor=? WHERE id=?",
                    ("stopped", iso(self.day()["ts"][self.cursor]), self.session_id),
                )
                self.conn.commit()
        return {"status": "stopped", "cursor": iso(self.day()["ts"][self.cursor])}

    def _clamp_cursor(self, idx: int) -> int:
        return int(max(0, min(len(self.day()["ts"]) - 1, idx)))

    def set_cursor(self, idx: int) -> None:
        with self.lock:
            self.cursor = self._clamp_cursor(idx)
            # A seek makes the latched alert states stale: after jumping the
            # operator should see a fresh gap/forecast alert for the new window.
            self._gap_latched = False
            self._forecast_high_latched = False

    def set_speed(self, speed: float) -> None:
        lo, hi = 1.0, 60.0
        with self.lock:
            self.speed = float(max(lo, min(hi, speed)))
        # Wake the sim loop so a speed change takes effect now rather than
        # after the remainder of the current (possibly 60 s) sleep.
        loop = self.loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self.speed_changed.set)

    def replay_state(self) -> dict:
        """Canonical replay state, returned by every control mutation so the
        client can sync immediately instead of waiting for the next WS frame."""
        return {
            "playing": self.playing,
            "speed": self.speed,
            "cursor_idx": self.cursor,
            "cursor": iso(self.day()["ts"][self.cursor]),
            "event_date": self.event_date,
            "mode": self.mode,
        }

    ACTIONS = ("play", "pause", "toggle", "stop", "seek", "speed", "status")

    def control(
        self, action: str, speed: float | None = None, cursor: int | None = None
    ) -> dict:
        """Unified replay control. `speed` and `cursor` may accompany any action."""
        if action not in self.ACTIONS:
            raise ValueError(
                f"unknown replay action '{action}'; expected one of {', '.join(self.ACTIONS)}"
            )
        if action == "seek" and cursor is None:
            raise ValueError("action 'seek' requires 'cursor'")
        if action == "speed" and speed is None:
            raise ValueError("action 'speed' requires 'speed'")

        if action == "stop":
            self.stop_replay()
            if speed is not None:
                self.set_speed(speed)
            if cursor is not None:
                self.set_cursor(cursor)
            return self.replay_state()

        if speed is not None:
            self.set_speed(speed)
        if cursor is not None:
            self.set_cursor(cursor)
        with self.lock:
            if action == "play":
                self.playing = True
            elif action == "pause":
                self.playing = False
            elif action == "toggle":
                self.playing = not self.playing
        return self.replay_state()

    def tick(self) -> dict:
        with self.lock:
            prev_state = None
            try:
                prev_nc = self._nowcast_until(self.cursor)
                prev_state = prev_nc.state
                prev_n = len(prev_nc.events)
                prev_idx = self.impact_current()["index"]
            except Exception:
                prev_n, prev_idx = 0, 0
            last = len(self.day()["ts"]) - 1
            if self.playing:
                if self.cursor >= last:
                    # End of the replay day: stop instead of re-emitting alerts
                    # for the same final minute on every subsequent tick.
                    self.playing = False
                else:
                    self.cursor += 1
            self.last_tick = datetime.now(UTC)
            ts = iso(self.day()["ts"][self.cursor])
            if self.day()["quality"][self.cursor] == 0:
                # One alert per contiguous gap, not one per missing minute.
                if not self._gap_latched:
                    self._gap_latched = True
                    self._emit_alert("data_gap", "R1", None, f"DATA GAP from {ts}", ts)
            else:
                self._gap_latched = False
            nc = self._nowcast_until(self.cursor)
            if len(nc.events) > prev_n:
                ev = nc.events[-1]
                self._emit_alert(
                    "flare_onset",
                    "R2",
                    ev.id,
                    f"Onset {ev.class_label} candidate at {ts} ({ev.detection_method})",
                    ts,
                )
            if nc.state == "peak" and prev_state != "peak" and nc.events:
                ev = nc.events[-1]
                self._emit_alert("flare_peak", ev.severity_band or "R2", ev.id, f"Peak {ev.class_label} {ts}", ts)
            impact = self.impact_current()
            if impact["index"] is not None and impact["index"] >= prev_idx + 1.0 and impact["index"] >= 4:
                self._emit_alert(
                    "severity_increase",
                    impact["band"],
                    impact.get("flare_id"),
                    f"Impact index {impact['index']} ({impact['band']})",
                    ts,
                )
            fc = self.forecast_horizons()
            hi = float(self.cfg["forecast"]["high_alert"])
            if any(h["p_c1"] >= hi for h in fc["horizons"]):
                # Latches: only alert on the transition into the high-probability
                # regime, not once per minute for as long as it persists.
                if not self._forecast_high_latched:
                    self._forecast_high_latched = True
                    self._emit_alert(
                        "forecast_high", "R2", None, f"P(≥C1) ≥ {hi:.2f} on a forecast horizon", ts
                    )
            else:
                self._forecast_high_latched = False
            payload = {
                "nowcast_state": self.nowcast_state(),
                "latest_points": self.streams_latest(180),
                "forecast": fc,
                "impact": impact,
                "alerts": self.alerts(None)[:6],
                "clock": {
                    "utc": ts,
                    "ist": (self.day()["ts"][self.cursor] + timedelta(hours=5, minutes=30)).strftime(
                        "%Y-%m-%dT%H:%M:%S+05:30"
                    ),
                },
                "mode": self.mode,
                "playing": self.playing,
                "speed": self.speed,
                "event_date": self.event_date,
                "cursor_idx": self.cursor,
            }
            return payload

    def live_snapshot(self) -> dict:
        return {
            "nowcast_state": self.nowcast_state(),
            "latest_points": self.streams_latest(180),
            "forecast": self.forecast_horizons(),
            "impact": self.impact_current(),
            "alerts": self.alerts(None)[:6],
            "clock": {
                "utc": iso(self.day()["ts"][self.cursor]),
                "ist": (self.day()["ts"][self.cursor] + timedelta(hours=5, minutes=30)).strftime(
                    "%Y-%m-%dT%H:%M:%S+05:30"
                ),
            },
            "mode": self.mode,
            "playing": self.playing,
            "speed": self.speed,
            "event_date": self.event_date,
            "cursor_idx": self.cursor,
            "dates": self.available_dates(),
        }


# Constructed without booting: importing this module must be cheap and free of
# side effects. The API boots the engines during startup (off the event loop),
# and any other entry point can call runtime.boot() explicitly.
runtime = Runtime(boot=False)
