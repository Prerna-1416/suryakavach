# SURYAKAVACH Unfinished Work Implementation Plan

**Status:** active implementation  
**Last updated:** 2026-09-19  
**Purpose:** handoff-ready roadmap for completing the real-data, scientific,
dashboard, and production-readiness work without overstating operational skill.

## Non-negotiable engineering rules

- Treat PRADAN credentials and session cookies as local/deployment secrets only.
  They belong in ignored `.env` or deployment secrets, never source control.
- Preserve source-file hash, portal product identity, product level, unit,
  time coverage, and parser version for every observed value.
- Never use SoLEXS `COUNTS` as GOES-equivalent W/m² or derive an R scale until a
  documented calibration/validation layer exists.
- Keep synthetic replay available for development, but label every API/UI result
  as `synthetic` or `observed` and prohibit mixed evaluation cohorts.
- Use time-disjoint train/calibration/test partitions. Features at minute `t`
  may use only observations at or before `t`.

## Current verified baseline

### Implemented in the active working tree

- Dynamic authenticated PRADAN/ISSDC Keycloak session:
  `backend/suryakavach/ingest/pradan_session.py`.
- PRADAN catalogue parsing plus atomic product downloader and SHA-256 manifest:
  `backend/suryakavach/ingest/pradan_catalogue.py`.
- Real SoLEXS FITS light-curve reader:
  `backend/suryakavach/ingest/fits_products.py`.
- Real MAG Level-2 NetCDF4 reader:
  `backend/suryakavach/ingest/magnetometer.py`.
- Unit-aware one-minute alignment contract:
  `backend/suryakavach/ingest/fusion.py`.
- One verified SoLEXS L1 archive and MAG L2 file live under ignored
  `data/raw/pradan/`, each with a JSON SHA-256 manifest.
- Backend test suite passes at the time of this plan: 27 tests.

### Current real-product facts

| Instrument | Verified PRADAN product | Format | Native cadence | Operational status |
|---|---|---|---:|---|
| SoLEXS | L1 archive with `RATE(TIME, COUNTS)` | `.zip` → `.lc.gz` FITS table | 1 s | usable as observed count feature, not calibrated flux |
| MAG | L2 `Bx/By/Bz` vectors and quality flag | NetCDF4 | 10 s | usable as observed magnetic-field feature |
| HEL1OS | catalogue available | ZIP product, schema not yet sampled | unknown | pending bounded sample/download/parser |
| SUIT | catalogue available | FITS | image cadence | pending bounded sample/download/feature extractor |

## Phase 0 — Lock scientific and data contracts

**Goal:** specify what is being predicted and ensure data can legally and
scientifically support it.

### Work

1. Choose authoritative labels:
   - flare onset/peak/class: NOAA GOES event catalogue or an approved equivalent;
   - impact labels: a documented radiation-impact mapping, not an inferred R
     scale from uncalibrated counts.
2. Write `docs/data-contract.md` with:
   - units, native cadence, product-level, and known fill values per instrument;
   - standard UTC timestamp semantics;
   - quality-mask policy;
   - PRADAN acknowledgement/licensing requirements;
   - allowed data-source states: `synthetic`, `observed_uncalibrated`,
     `observed_calibrated`.
3. Define a time-based split manifest (train, validation, calibration, holdout)
   before model work begins.

### Files

- Create `docs/data-contract.md`.
- Create `data/splits/` templates (ignored datasets; commit only schemas).
- Extend `config.yaml` with explicit source/calibration/model settings.

### Acceptance

- Every cached product can be classified by source state and unit.
- The project has an approved label source and no overlap between test and
  model-selection periods.

### External dependency

- Product documentation/user manual and an owner decision on label authority.

## Phase 1 — Complete PRADAN ingest and cache registry

**Goal:** download, verify, extract, index, and re-run observed products safely.

### Work

1. Add a `raw_products` registry with filename, instrument, product level,
   observation coverage, local path, bytes, SHA-256, portal URL (query removed),
   download time, parser version, and processing state.
2. Add a command such as:
   `python -m suryakavach.ingest.cli catalogue --payload solexs` and bounded
   `download --payload solexs --day 2024-02-12`.
3. Finish PRADAN catalogue pagination/date selection; never bulk-pull the full
   archive until storage/cadence budget and resume behavior are verified.
4. Safely extract ZIP products, reject path traversal, and preserve raw archive
   as immutable evidence.
5. Implement actual HEL1OS archive inspection/reader and SUIT FITS metadata
   reader with a one-product test fixture for each.
6. Replace `fetch_pradan_day()` only after the selector is reliable; it must
   download exact product IDs, never guess a URL.

### Files

- Continue `backend/suryakavach/ingest/pradan_session.py`.
- Continue `backend/suryakavach/ingest/pradan_catalogue.py`.
- Continue `backend/suryakavach/ingest/fits_products.py`.
- Add `backend/suryakavach/ingest/registry.py` and `cli.py`.
- Extend `backend/suryakavach/db.py` plus its Supabase shim/migration path.
- Add `backend/tests/test_registry.py`, `test_hel1os.py`, `test_suit.py`.

### Acceptance

- Downloading an existing product is idempotent and hash-verified.
- A stopped transfer leaves no completed-looking file.
- Raw products can be traced from a normalized row back to their source archive.

## Phase 2 — Multi-instrument normalized feature store

**Goal:** create an explicit, unit-safe observed minute grid; do not fake a
single physical stream.

### Work

1. Finalise `InstrumentSeries`/`FusedMinuteGrid` as the public ingest contract.
2. Produce one-minute channel arrays plus availability and quality masks for:
   SoLEXS counts/calibrated flux, HEL1OS channels, SUIT-derived UV features,
   and MAG vector/magnitude/derivative features.
3. Persist normalized data to partitioned Parquet (or another versioned
   columnar store) alongside a schema/version manifest.
4. Add source-aware runtime modes:
   - `synthetic` replay;
   - `observed_uncalibrated` diagnostic replay;
   - `observed_calibrated` operational-candidate replay.
5. Do not overlay real days with empty truth labels into synthetic model
   training, as the current runtime can do.

### Files

- Continue `backend/suryakavach/ingest/fusion.py`.
- Add `backend/suryakavach/ingest/features.py` and `feature_store.py`.
- Update `backend/suryakavach/runtime.py` source/provenance handling.
- Add `backend/tests/test_feature_store.py` and runtime provenance tests.

### Acceptance

- Every minute/channel exposes unit, quality, availability, and source hash.
- Missing SUIT/MAG values remain missing; no forward fill is used to fabricate
  observed instrument availability.
- Runtime cannot treat uncalibrated counts as impact/GOES flux.

## Phase 3 — Calibration and unified impact scale

**Goal:** make physical impact claims only from calibrated/validated inputs and
remove backend/frontend scale drift.

### Work

1. Build/validate a SoLEXS-to-reference flux calibration strategy using
   documented products and matched events; version its coefficients/data.
2. Centralise severity bands and impact weights in backend configuration/API.
3. Return `impact_scale_version`, `source_state`, component units, and missing
   components in every impact response.
4. Replace frontend `R_SCALE`/`IMPACT_WEIGHTS` duplication with API-derived
   scale metadata.
5. Define SUIT and MAG contributions as features with justification; do not
   add a weight merely because a PPT claims the instrument is fused.

### Files

- Add `backend/suryakavach/engines/calibration.py`.
- Update `backend/suryakavach/engines/impact.py`, `runtime.py`, `api.py`, and
  `config.yaml`.
- Update `apps/web/src/lib/constants.ts`, `types/api.ts`, `ImpactGauge.tsx`,
  alert components, and contract tests.

### Acceptance

- Boundary tests prove one index maps identically across API/UI/alerts/exports.
- Uncalibrated observed products display a diagnostic status, not an R1–R5
  assertion.

## Phase 4 — Real evaluation and backtesting

**Goal:** quantify performance honestly on held-out real events.

### Work

1. Replace synthetic-only `evaluate.py` report with structured evaluation runs.
2. Calculate detection TSS, HSS, FAR, precision/recall, onset/peak lead-time
   distributions, and per-horizon Brier score.
3. Add calibration/reliability curves, confidence intervals, event matching
   rules, and failure slices (quiet periods, M+, X+, data gaps).
4. Persist result JSON with dataset hashes, source split ID, config hash, model
   version, and code revision.
5. Keep synthetic metrics separately labelled for demo-regression tests only.

### Files

- Rewrite `backend/suryakavach/evaluate.py` into library + CLI.
- Add `backend/suryakavach/evaluation/` (matching, metrics, calibration,
  report, schemas).
- Add real/synthetic fixture tests under `backend/tests/`.
- Add `evaluation_runs` persistence migration/shim support.

### Acceptance

- Same data/config/model inputs reproduce the same report.
- Held-out score selection cannot inspect its own labels during training/tuning.
- Report visibly identifies source, sample count, split, and uncertainty.

## Phase 5 — PyTorch deep discrete-time survival forecast

**Goal:** replace the PPT-only claim with a versioned model that earns
deployment against a baseline.

### Work

1. Retain `DiscreteHazard` as baseline/fallback.
2. Build causal sequence windows from the normalized feature store.
3. Implement a PyTorch discrete-time survival model with separate C1+/M1+
   hazard heads, censoring-aware labels, and saved feature schema.
4. Train only on the training split; tune/calibrate on calibration split;
   select model once against held-out data.
5. Export CPU inference checkpoint plus model-card JSON; runtime must fall back
   cleanly when the checkpoint is unavailable or feature contract mismatches.

### Files

- Add `backend/suryakavach/models/` (dataset, survival, train, infer,
  calibration, registry).
- Add PyTorch pin to `backend/requirements.txt` after target CPU platform is
  agreed.
- Update `runtime.py`/`forecast.py` behind a model-provider interface.
- Add model unit, leakage, inference-contract, and fallback tests.

### Acceptance

- No deep-model claim appears until held-out real-data metrics and calibration
  meet agreed promotion thresholds.
- Model artifact contains data/split/config/code provenance and can be loaded
  by a clean runtime.

### External dependency

- Enough labelled, calibrated observed history to support temporal holdout.

## Phase 6 — Metrics API and live dashboard

**Goal:** eliminate hard-coded validation numbers and expose live provenance.

### Work

1. Add `GET /api/metrics` and optionally `/api/metrics/{run_id}`; return latest
   approved evaluation run, age, source, model/config/data versions, cohorts,
   scores, lead time, and calibration summary.
2. Add frontend query/type/Zod contract and replace static `METRICS`.
3. Show empty/stale/not-approved states rather than stale demo values.
4. Add dashboard charts for reliability and per-horizon Brier only when an
   evaluation run supplies them.

### Files

- Update `backend/suryakavach/api.py`, `runtime.py`, `db.py` and Supabase shim.
- Update `apps/web/src/lib/hooks.ts`, `types/api.ts`, `MetricsPanel.tsx`,
  `constants.ts`, `contract.test.ts`, and component tests.

### Acceptance

- Dashboard metrics originate from `/api/metrics`; no hand-transcribed metric
  constant remains.
- Every displayed metric is linked to an evaluation-run provenance ID.

## Phase 7 — Production readiness

**Goal:** make data/model operations deployable, observable, and testable.

### Work

1. Add Ruff/formatting for Python, ESLint/formatting for TypeScript, and pinned
   reproducible installs (`npm ci`, locked Python environment).
2. Add CI: backend tests, frontend typecheck/Vitest, container build, targeted
   integration tests, dependency/security scan, and cache-free boot test.
3. Test Supabase query/migration paths with a test double or disposable DB.
4. Add structured JSON logs, request IDs, Prometheus metrics/Grafana dashboards,
   and Sentry (environment-gated).
5. Add readiness diagnostics for cache health, model availability, source age,
   and evaluation freshness.
6. Protect replay mutations and WebSockets: authentication/authorisation,
   trusted-proxy rate-limit policy, origin checks, connection caps, cleanup.
7. Add cache retention, disk-quota guardrails, backup/restore, and an operator
   runbook for PRADAN session expiry/retry.

### Files

- Add `.github/workflows/ci.yml`, lint/format configs, and runbook docs.
- Update Dockerfiles, `docker-compose.yml`, `render.yaml`, API middleware, and
  frontend WebSocket lifecycle.
- Add tests for existing fragile paths: malformed PRADAN rows, FITS-only data,
  non-finite BOCPD inputs, Supabase alerts/catalogue, WebSocket cleanup, and
  E2E backend+frontend flow.

### Acceptance

- CI passes from a clean checkout.
- Staging deployment exposes health, metrics, error tracking, and a tested
  rollback/cache-recovery procedure.
- Production does not expose global replay control or unbounded sockets to
  anonymous traffic.

## Recommended execution order

1. Finish Phase 1 and implement the Phase 2 feature-store contract.
2. Complete Phase 3 calibration/impact unification before showing observed
   impact levels.
3. Build Phase 4 evaluation before Phase 5 model selection.
4. Deliver Phases 5 and 6 together: model selection produces the metrics API
   data that the UI consumes.
5. Run Phase 7 continuously, with CI/lint/security added early instead of as
   a final-only effort.

## Handoff checklist for another agent

1. Read this document and `.planning/codebase/{ARCHITECTURE,CONCERNS,TESTING}.md`.
2. Preserve existing uncommitted changes in `.gitignore`, `bocpd.py`,
   `pradan.py`, and `scripts/dev.mjs` unless explicitly fixing them.
3. Never print/read `.env` secret values; only test presence or authenticate
   through `PradanSession.from_environment()`.
4. Start with a bounded product download and inspect it before automating a
   batch or making unit assumptions.
5. Run `pytest -q` from `backend/` after each backend slice; the current
   environment emits a NumPy/netCDF binary-compatibility warning that should be
   resolved in a clean pinned virtual environment before release.
