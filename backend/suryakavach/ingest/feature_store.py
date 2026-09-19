from __future__ import annotations

"""Versioned Parquet persistence for normalized observed minute-grid channels."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from suryakavach.ingest.fusion import FusedMinuteGrid

UTC = timezone.utc
FEATURE_STORE_VERSION = "observed-minute-grid-v1"


def write_minute_grid(
    grid: FusedMinuteGrid,
    root: str | Path,
    source_state: str,
    product_hashes: dict[str, str],
    run_id: str | None = None,
) -> Path:
    """Write a partitioned long-form Parquet grid plus immutable manifest."""
    if source_state not in {"synthetic", "observed_uncalibrated", "observed_calibrated"}:
        raise ValueError(f"unknown source_state {source_state}")

    if source_state != "synthetic":
        for channel in grid.values:
            src_file = grid.provenance.get(channel)
            if not src_file:
                raise ValueError(f"channel '{channel}' missing non-empty source_file in provenance")
            src_hash = product_hashes.get(src_file)
            if not src_hash:
                raise ValueError(f"channel '{channel}' source_file '{src_file}' missing non-empty product_hash")

    root_path = Path(root)
    if not run_id:
        import hashlib
        h_src = json.dumps(product_hashes, sort_keys=True)
        run_id = hashlib.sha256(f"{grid.day}:{source_state}:{h_src}".encode("utf-8")).hexdigest()[:12]

    partition = root_path / f"source_state={source_state}" / f"day={grid.day}" / f"run={run_id}"
    if partition.exists():
        raise ValueError(f"partition directory {partition} already exists")

    rows: list[dict[str, Any]] = []
    for channel, values in grid.values.items():
        quality = grid.quality[channel]
        src_file = grid.provenance[channel]
        src_hash = product_hashes[src_file] if source_state != "synthetic" else product_hashes.get(src_file, "")
        for timestamp, value, present in zip(grid.timestamps, values, quality):
            rows.append(
                {
                    "timestamp": timestamp.isoformat(),
                    "channel": channel,
                    "value": float(value) if np.isfinite(value) else None,
                    "quality": int(present),
                    "unit": grid.units[channel],
                    "source_file": src_file,
                    "source_hash": src_hash,
                }
            )

    table = pa.Table.from_pylist(rows)
    manifest = {
        "feature_store_version": FEATURE_STORE_VERSION,
        "day": grid.day,
        "source_state": source_state,
        "run_id": run_id,
        "created_at": datetime.now(UTC).isoformat(),
        "channels": sorted(grid.values),
        "units": grid.units,
        "provenance": grid.provenance,
        "product_hashes": product_hashes,
        "aggregation": "finite native samples averaged within UTC one-minute bins",
        "data_file": "channels.parquet",
    }
    manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")

    partition.parent.mkdir(parents=True, exist_ok=True)
    temp_partition = partition.with_name(f"{partition.name}.tmp_{os.getpid()}_{datetime.now(UTC).strftime('%H%M%S%f')}")
    if temp_partition.exists():
        shutil.rmtree(temp_partition, ignore_errors=True)
    temp_partition.mkdir(parents=True, exist_ok=False)

    try:
        temp_data_path = temp_partition / "channels.parquet"
        temp_manifest_path = temp_partition / "manifest.json"
        pq.write_table(table, temp_data_path)
        temp_manifest_path.write_bytes(manifest_bytes)
        temp_partition.replace(partition)
    except Exception:
        if temp_partition.exists():
            shutil.rmtree(temp_partition, ignore_errors=True)
        raise

    return partition / "channels.parquet"



def read_minute_grid_manifest(data_path: str | Path) -> dict[str, Any]:
    """Read the matching manifest for a normalized Parquet data file."""
    path = Path(data_path)
    return json.loads((path.parent / "manifest.json").read_text(encoding="utf-8"))
