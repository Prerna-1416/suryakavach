from __future__ import annotations

from datetime import datetime, timezone
import zipfile

import numpy as np
from astropy.io import fits
import pytest

from suryakavach.ingest.fits_products import (
    extract_product_archive,
    read_fits_lightcurve,
    read_hel1os_lightcurves,
    read_suit_image_feature,
)


def test_read_fits_lightcurve_preserves_count_units_and_unix_timestamps(tmp_path):
    table = fits.BinTableHDU.from_columns(
        [
            fits.Column(name="TIME", format="D", array=np.array([1_707_696_000.0, 1_707_696_001.0])),
            fits.Column(name="COUNTS", format="D", array=np.array([np.nan, 42.0])),
        ],
        name="RATE",
    )
    table.header["MJDREFI"] = 40587
    table.header["TIMEUNIT"] = "s"
    path = tmp_path / "lightcurve.fits.gz"
    fits.HDUList([fits.PrimaryHDU(), table]).writeto(path)

    curve = read_fits_lightcurve(path)

    assert curve.extension_name == "RATE"
    assert curve.value_column == "COUNTS"
    assert curve.value_unit == "counts"
    assert curve.is_calibrated_flux is False
    assert curve.timestamps == [
        datetime(2024, 2, 12, tzinfo=timezone.utc),
        datetime(2024, 2, 12, 0, 0, 1, tzinfo=timezone.utc),
    ]
    assert np.isnan(curve.values[0])
    assert curve.values[1] == 42.0


def test_extract_product_archive_rejects_path_traversal(tmp_path):
    archive = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("../outside.txt", "no")

    with pytest.raises(ValueError, match="unsafe archive member"):
        extract_product_archive(archive, tmp_path / "extract")


def test_read_hel1os_lightcurves_preserves_energy_band_count_rate(tmp_path):
    table = fits.BinTableHDU.from_columns(
        [
            fits.Column(name="ISOT", format="26A", array=["2024-02-12T00:00:00.000"]),
            fits.Column(name="CTR", format="D", unit="cts/sec", array=[3.0]),
        ],
        name="CDTE1_LC_BAND_5.00KEV_TO_20.00KEV",
    )
    path = tmp_path / "hel1os.fits"
    fits.HDUList([fits.PrimaryHDU(), table]).writeto(path)

    curves = read_hel1os_lightcurves(path)

    curve = curves["CDTE1_LC_BAND_5.00KEV_TO_20.00KEV"]
    assert curve.timestamps == [datetime(2024, 2, 12, tzinfo=timezone.utc)]
    assert curve.values.tolist() == [3.0]
    assert curve.value_unit == "cts/sec"
    assert curve.is_calibrated_flux is False


def test_read_suit_image_feature_keeps_native_image_semantics(tmp_path):
    primary = fits.PrimaryHDU(np.array([[1.0, np.nan], [3.0, 5.0]]))
    primary.header["DATE-OBS"] = "2024-02-12T00:00:00.000"
    primary.header["WAVELNTH"] = 2140
    primary.header["EXPTIME"] = 2.0
    path = tmp_path / "suit.fits"
    fits.HDUList([primary]).writeto(path)

    feature = read_suit_image_feature(path)

    assert feature.observed_at == datetime(2024, 2, 12, tzinfo=timezone.utc)
    assert feature.wavelength_angstrom == 2140.0
    assert feature.exposure_seconds == 2.0
    assert feature.mean_signal == 3.0
    assert feature.finite_fraction == 0.75
