from __future__ import annotations

import hashlib

import pytest

from suryakavach.ingest.registry import ObservedProduct, ObservedProductRegistry


def test_registry_verifies_and_lists_observed_product(tmp_path):
    product_file = tmp_path / "sample.zip"
    product_file.write_bytes(b"verified source data")
    product = ObservedProduct(
        payload="solexs",
        filename=product_file.name,
        local_path=str(product_file),
        source_url="https://pradan.issdc.gov.in/al1/protected/downloadData/solexs/sample.zip",
        sha256=hashlib.sha256(product_file.read_bytes()).hexdigest(),
        bytes=product_file.stat().st_size,
        observation_start="2024-02-12T00:00:00Z",
        observation_end="2024-02-12T23:59:59Z",
    )

    with ObservedProductRegistry(tmp_path / "registry.sqlite") as registry:
        registry.register(product)
        assert registry.list("solexs") == [product]


def test_registry_rejects_changed_observed_file(tmp_path):
    product_file = tmp_path / "sample.zip"
    product_file.write_bytes(b"original")
    product = ObservedProduct(
        payload="mag",
        filename=product_file.name,
        local_path=str(product_file),
        source_url="https://example.invalid/mag.nc",
        sha256=hashlib.sha256(b"original").hexdigest(),
        bytes=len(b"original"),
        observation_start=None,
        observation_end=None,
    )
    product_file.write_bytes(b"changed")

    with ObservedProductRegistry(tmp_path / "registry.sqlite") as registry:
        with pytest.raises(ValueError, match="SHA-256 mismatch"):
            registry.register(product)
