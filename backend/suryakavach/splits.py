from __future__ import annotations

"""Validation for leakage-safe, date-disjoint data split manifests."""

from dataclasses import dataclass
import datetime
from datetime import date as datetime_date
import json
from pathlib import Path


_SPLIT_NAMES = ("train", "calibration", "holdout")


@dataclass(frozen=True)
class SplitManifest:
    """An approved time-disjoint split for observed calibrated data."""

    id: str
    source_state: str
    label_source: str
    created_at: str
    data_hashes: tuple[str, ...]
    splits: dict[str, tuple[str, ...]]


def load_split_manifest(path: str | Path) -> SplitManifest:
    """Load and reject ambiguous, overlapping, or non-operational split inputs."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    source_state = str(raw.get("source_state", ""))
    if source_state != "observed_calibrated":
        raise ValueError("split manifests require source_state=observed_calibrated")
    split_values: dict[str, tuple[str, ...]] = {}
    seen: dict[str, str] = {}
    for name in _SPLIT_NAMES:
        dates = tuple(str(value) for value in raw.get("splits", {}).get(name, []))
        if not dates:
            raise ValueError(f"split {name} must contain at least one date")
        for date in dates:
            if len(date) != 10 or date[4] != "-" or date[7] != "-":
                raise ValueError(f"split {name} has invalid day {date}")
            try:
                datetime_date.fromisoformat(date)
            except ValueError:
                raise ValueError(f"split {name} has invalid day {date}")
            previous = seen.setdefault(date, name)
            if previous != name:
                raise ValueError(f"day {date} appears in both {previous} and {name}")
        split_values[name] = dates
    identifier = str(raw.get("id", ""))
    label_source = str(raw.get("label_source", ""))
    if not identifier or not label_source:
        raise ValueError("split manifest requires id and label_source")

    data_hashes = tuple(str(value) for value in raw.get("data_hashes", []))
    if not data_hashes:
        raise ValueError("split manifest requires at least one data hash in data_hashes")

    created_at_raw = str(raw.get("created_at", ""))
    if not created_at_raw:
        raise ValueError("split manifest requires a timezone-aware created_at timestamp")
    try:
        created_dt = datetime.datetime.fromisoformat(created_at_raw)
        if created_dt.tzinfo is None:
            raise ValueError("created_at timestamp must be timezone-aware")
    except Exception as exc:
        raise ValueError(f"split manifest requires a valid timezone-aware created_at timestamp: {exc}")

    return SplitManifest(
        id=identifier,
        source_state=source_state,
        label_source=label_source,
        created_at=created_at_raw,
        data_hashes=data_hashes,
        splits=split_values,
    )
