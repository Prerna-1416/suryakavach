from __future__ import annotations

"""Persistent local registry for immutable observed PRADAN products."""

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any

UTC = timezone.utc

_SCHEMA = """
CREATE TABLE IF NOT EXISTS observed_products (
  sha256 TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  filename TEXT NOT NULL,
  local_path TEXT NOT NULL,
  source_url TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  observation_start TEXT,
  observation_end TEXT,
  parser_version TEXT NOT NULL,
  registered_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_observed_products_payload_start
  ON observed_products (payload, observation_start);
"""


@dataclass(frozen=True)
class ObservedProduct:
    """A verified local product and the metadata required to reproduce it."""

    payload: str
    filename: str
    local_path: str
    source_url: str
    sha256: str
    bytes: int
    observation_start: str | None
    observation_end: str | None
    parser_version: str = "ingest-v1"

    @classmethod
    def from_download_manifest(
        cls, manifest: dict[str, str | int], local_path: str | Path, parser_version: str = "ingest-v1"
    ) -> ObservedProduct:
        """Build a registry record from ``download_product``'s manifest."""
        return cls(
            payload=str(manifest["payload"]),
            filename=str(manifest["filename"]),
            local_path=str(Path(local_path)),
            source_url=str(manifest["source_url"]),
            sha256=str(manifest["sha256"]),
            bytes=int(manifest["bytes"]),
            observation_start=_optional(manifest.get("observation_start")),
            observation_end=_optional(manifest.get("observation_end")),
            parser_version=parser_version,
        )


class ObservedProductRegistry:
    """SQLite index for observed raw files, independent from runtime replay DB."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)

    def register(self, product: ObservedProduct, verify: bool = True) -> None:
        """Upsert one product after optionally verifying its immutable file hash."""
        path = Path(product.local_path)
        if verify:
            if not path.is_file():
                raise FileNotFoundError(f"observed product file is missing: {path}")
            actual = _sha256(path)
            if actual != product.sha256:
                raise ValueError(f"SHA-256 mismatch for {path.name}")
            if path.stat().st_size != product.bytes:
                raise ValueError(f"byte-size mismatch for {path.name}")
        self.conn.execute(
            """INSERT OR REPLACE INTO observed_products
            (sha256, payload, filename, local_path, source_url, bytes,
             observation_start, observation_end, parser_version, registered_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                product.sha256,
                product.payload,
                product.filename,
                product.local_path,
                product.source_url,
                product.bytes,
                product.observation_start,
                product.observation_end,
                product.parser_version,
                datetime.now(UTC).isoformat(),
            ),
        )
        self.conn.commit()

    def list(self, payload: str | None = None) -> list[ObservedProduct]:
        """Return cached products in deterministic observation-time order."""
        if payload:
            rows = self.conn.execute(
                "SELECT * FROM observed_products WHERE payload = ? ORDER BY observation_start, filename", (payload,)
            ).fetchall()
        else:
            rows = self.conn.execute("SELECT * FROM observed_products ORDER BY payload, observation_start, filename").fetchall()
        return [
            ObservedProduct(
                payload=row["payload"],
                filename=row["filename"],
                local_path=row["local_path"],
                source_url=row["source_url"],
                sha256=row["sha256"],
                bytes=row["bytes"],
                observation_start=row["observation_start"],
                observation_end=row["observation_end"],
                parser_version=row["parser_version"],
            )
            for row in rows
        ]

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> ObservedProductRegistry:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def load_download_manifest(path: str | Path) -> dict[str, str | int]:
    """Load one downloader manifest without accepting arbitrary JSON shapes."""
    data: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    required = {"payload", "filename", "source_url", "sha256", "bytes"}
    missing = required.difference(data)
    if missing:
        raise ValueError(f"download manifest is missing: {', '.join(sorted(missing))}")
    return data


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _optional(value: str | int | None) -> str | None:
    return str(value) if value else None
