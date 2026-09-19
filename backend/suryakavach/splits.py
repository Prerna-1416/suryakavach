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
    return SplitManifest(
        id=identifier,
        source_state=source_state,
        label_source=label_source,
        data_hashes=tuple(str(value) for value in raw.get("data_hashes", [])),
        splits=split_values,
    )
