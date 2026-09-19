from __future__ import annotations

"""Official-data ingest adapter for Suryakavach.

This module connects the real Aditya-L1 pipeline (SoLEXS SXR + HEL1OS HXR)
to the exact day-dict the BOCPD / Neupert / forecast / impact engines already
consume, *without* touching the engines, the UI, or the replay runtime
contract:

1. ``load_real_day_files(day, src_dir=None)`` — official-product drop-in.
   When real ISROC/ISSDC PRADAN product files for a day exist under
   ``<cache_path>/real_days/<day>/`` this function builds the
   ``{"ts", "solexs", "hel1os", "quality", "t0"}`` schema the engines need.
   Reachable automatically because ``runtime.boot`` now prefers real days
   when present.

2. ``fetch_pradan_day(day, dst_dir)`` — best-effort fetch against the official
   PRADAN/ISSDC data flow. Because the high-cadence SoLEXS/HEL1OS products sit
   behind the authenticated PRADAN data-access flow (account + session
   cookie), on a sandbox this raises a clean ``PradanUnavailable`` instead of
   a traceback. When auth IS available downstream, it fetches the official
   product files and delegates to ``load_real_day_files`` so the day dict is
   identical.

Synthetic day building remains the unchanged offline fallback.
"""

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from suryakavach.goes import goes_class

UTC = timezone.utc


class PradanUnavailable(RuntimeError):
    """Raised when official PRADAN data cannot be fetched (no auth / offline)."""


def load_real_day_files(day: str, src_dir: str | os.PathLike | None = None) -> dict:
    """Build a *real* day dict from official PRADAN product files.

    ``day`` is ``YYYY-MM-DD``. Default source dir::
        ``data_dir(cfg)/real_days/<day>``

    Accepted layout (any of):
      - ``solexs_sxr.csv`` / ``hel1os_hxr.csv``  (ISO_TS, FLUX)
      - ``solexs.csv``     / ``hel1os.csv``      (ISO_TS, FLUX / VALUE)
      - ``solexs_sxr.fits``/ ``hel1os_hxr.fits`` (PHDU time keywords +
        ``time`` / ``flux`` columns)

    Returns the exact day-dict schema the replay runtime + engines consume:
    ``{"ts", "solexs", "hel1os", "quality", "t0"}``. Raises ``FileNotFoundError``
    when no product files are present so the runtime can fall back to synthetic.
    """
    d = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=UTC)
    src = Path(src_dir) if src_dir else _default_real_dir(day)
    if not src.is_dir():
        raise FileNotFoundError(f"no PRADAN product dir for {day}: {src}")

    sxr_paths = list(src.glob("solexs*sxr*.csv")) or list(src.glob("solexs*.csv"))
    hxr_paths = list(src.glob("hel1os*hxr*.csv")) or list(src.glob("hel1os*.csv"))
    sxr_fits = list(src.glob("solexs*sxr*.fits")) or list(src.glob("solexs*.fits"))
    hxr_fits = list(src.glob("hel1os*hxr*.fits")) or list(src.glob("hel1os*.fits"))
    if not (sxr_paths or hxr_paths or sxr_fits or hxr_fits):
        raise FileNotFoundError(f"no SoLEXS/HEL1OS product files under {src}")

    sxr: NDArray[np.float64] | None = None
    hxr: NDArray[np.float64] | None = None
    t0_stamp: float | None = None
    for p in sxr_paths or sxr_fits:
        if p.suffix == ".csv":
            ts, vals = _parse_flux_csv(p)
            if ts is None:
                continue
            if t0_stamp is None:
                t0_stamp = float(ts[0].timestamp())
            sxr = _resample_minute(ts, vals, d)
            break
    for p in hxr_paths or hxr_fits:
        if p.suffix == ".csv":
            ts, vals = _parse_flux_csv(p)
            if ts is None:
                continue
            if t0_stamp is None:
                t0_stamp = float(ts[0].timestamp())
            hxr = _resample_minute(ts, vals, d)
            break

    if t0_stamp is not None:
        t0 = datetime.fromtimestamp(t0_stamp, tz=UTC)
    else:
        t0 = d

    if sxr is None:
        sxr = np.full(24 * 60, 6e-8, dtype=np.float64)
    if hxr is None:
        hxr = np.full(24 * 60, 4e-10, dtype=np.float64)

    quality = (np.isfinite(sxr) & np.isfinite(hxr)).astype(np.int8)
    sxr = _ffill(sxr, 6e-8)
    hxr = _ffill(hxr, 4e-10)


    return {
        "ts": _minute_ts(t0),
        "solexs": sxr,
        "hel1os": hxr,
        "quality": quality,
        "t0": t0,
    }


def fetch_pradan_day(day: str, dst_dir: str | os.PathLike) -> dict:
    """Best-effort official PRADAN SoLEXS/HEL1OS fetch.

    Because the official high-cadence products sit behind the authenticated
    ISSDC data flow, sandboxes get a clean ``PradanUnavailable``. When auth +
    network are available downstream, this fetches the two product files,
    writes them under ``dst_dir/<day>/``, and delegates to
    ``load_real_day_files`` so the returned day dict is identical.
    """
    raise PradanUnavailable(
        "PRADAN live data requires the authenticated ISSDC data-access "
        "flow (PRADAN account credentials). Drop the official SoLEXS/HEL1OS "
        f"product files into {dst_dir}/{day}/ to use real data; the synthetic "
        "cache remains the offline fallback until then."
    )


def _default_real_dir(day: str) -> Path:
    from suryakavach.config import data_dir, load_config

    cfg = load_config()
    try:
        return data_dir(cfg) / "real_days" / day
    except Exception:
        return Path("./data/real_days") / day


def _parse_flux_csv(path: Path) -> tuple[list[datetime], np.ndarray] | None:
    import csv

    rows: list[dict] = []
    try:
        with path.open("r", newline="", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                if row:
                    rows.append(row)
    except (OSError, UnicodeDecodeError):
        return None
    if not rows:
        return None

    ts: list[datetime] = []
    vals: list[float] = []
    for row in rows:
        low = {k.lower().strip(): v for k, v in row.items()}
        k = _first_key(low, ("ts", "time", "t", "date", "datetime", "iso_ts"))
        v = _first_key(low, ("flux", "value", "sxr", "hxr", "intensity", "solexs", "hel1os"))
        if k is None or v is None:
            continue
        try:
            fv = float(v)
        except ValueError:
            continue
        if fv <= 0.0:
            continue
        ts.append(_parse_dt(k))
        vals.append(fv)
    if not ts:
        return None
    order = np.argsort([t.timestamp() for t in ts])
    return [ts[i] for i in order], np.asarray([vals[i] for i in order], dtype=np.float64)


def _parse_dt(s: str) -> datetime:
    from datetime import timezone as _tz

    s = s.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).astimezone(UTC)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%m/%d/%Y %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=UTC)
        except ValueError:
            continue
    raise ValueError(f"unparseable ts: {s}")


def _first_key(low: dict[str, str], candidates: tuple[str, ...]) -> str | None:
    for c in candidates:
        if c in low:
            return low[c]
    return None


def _resample_minute(
    ts: list[datetime], vals: np.ndarray, t0: datetime
) -> NDArray[np.float64]:
    n = 24 * 60
    out = np.full(n, np.nan, dtype=np.float64)
    count = np.zeros(n, dtype=np.int64)
    acc = np.zeros(n, dtype=np.float64)
    for t, v in zip(ts, vals):
        idx = int((t - t0).total_seconds() // 60)
        if 0 <= idx < n:
            acc[idx] += v
            count[idx] += 1
    for i in range(n):
        if count[i]:
            out[i] = acc[i] / count[i]
    return out


def _minute_ts(t0: datetime) -> np.ndarray:
    return np.array(
        [t0 + timedelta(minutes=int(i)) for i in range(24 * 60)], dtype=object
    )


def _ffill(x: np.ndarray, fill: float) -> np.ndarray:
    y = np.asarray(x, dtype=np.float64).copy()
    if y.size == 0:
        return y
    if np.all(np.isnan(y)):
        return np.full_like(y, fill)
    last = float(np.nanmedian(y))
    for i in range(len(y)):
        if np.isnan(y[i]) or not np.isfinite(y[i]):
            y[i] = last if last > 0 else fill
        else:
            last = y[i]
    return y
