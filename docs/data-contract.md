# SURYAKAVACH Data and Scientific Contract

## Purpose and scope

This contract governs all data entering SURYAKAVACH and prevents diagnostic,
synthetic, or uncalibrated observations from being represented as operational
space-weather performance.

## Source states

| State | Meaning | Allowed uses | Prohibited uses |
|---|---|---|---|
| `synthetic` | Deterministic generated replay data | UI development, detector regression tests | scientific or operational claims |
| `observed_uncalibrated` | Authentic PRADAN product whose measurement is not mapped to a validated physical unit | diagnostics, feature research, parser tests | GOES class, R-scale, operational impact, model evaluation against physical labels |
| `observed_calibrated` | Authentic observation with versioned calibration and validation evidence | approved forecast/impact experiments, held-out evaluation | use outside its stated calibration domain |

Every API payload, normalized record, cached product, report, and dashboard
panel must expose its source state.

## Canonical time and quality rules

- All timestamps are timezone-aware UTC ISO-8601 values.
- Native product timestamps are retained; one-minute derived data is a separate
  artifact and records the aggregation method.
- Instrument availability is represented by a per-channel quality mask. Missing
  observed samples stay missing. Forward fill is allowed only inside legacy
  synthetic-engine compatibility paths and must never change observed
  availability metadata.
- Every raw product must retain: PRADAN payload route, downloaded filename,
  source URL without temporary query state, SHA-256, byte count, observation
  coverage, parser version, and cache path.

## Instrument data currently supported

| Instrument | Product | Native measurement | Unit/state | Notes |
|---|---|---|---|---|
| SoLEXS | L1 `RATE` FITS table | `TIME`, `COUNTS` | counts / `observed_uncalibrated` | one-second L1 count series is not W/m2 |
| HEL1OS | L1 archive | pending schema inspection | pending | parse product before using it in any feature |
| SUIT | L1 FITS image | pending feature definition | pending | image features need an approved extraction recipe |
| MAG | L2 NetCDF4 | `Bx/By/Bz` in GSE/GSM plus quality | nT / `observed_uncalibrated` | ten-second samples in verified product |

## Label and calibration policy

- The authoritative flare-event label dataset must be named and versioned in
  the split manifest before any observed-data evaluation starts.
- SoLEXS counts must have a documented, versioned calibration to a compatible
  reference flux before producing a GOES class or R-scale impact.
- Calibration coefficients must identify calibration data, validation data,
  valid time range, feature units, and uncertainty.

## Leakage-safe train/calibration/holdout splits

- Splits are date-disjoint. An observation day may appear in one split only.
- A model feature at time `t` may use observations at or before `t` only.
- Calibration data is not allowed in final held-out score reporting.
- A split manifest stores the label source/version, data hashes, and creation
  timestamp. Split overlap is a hard error.

## Attribution and access

PRADAN/ISSDC data remains ISRO property and is subject to the portal's data-use
terms and acknowledgement requirements. Credentials, cookies, and signed URLs
are secrets; only stable source paths without query parameters may be stored in
the product registry.
