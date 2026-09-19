# SURYAKAVACH
VIDEO DEMO LINK:https://youtu.be/q68Ok05HQUg?si=zslCVI93u0HWZv6M
Vercel deployed link:- https://suryakavach.vercel.app/
**India's indigenous solar-flare early-warning prototype** for SIH 2026 (SIH26209 · Space Technology).

SURYAKAVACH turns Aditya-L1 SoLEXS, HEL1OS, SUIT, and MAG observations into three operational answers:

1. Is a solar flare happening now?
2. How likely is a C- or M-class flare in the next 5, 10, 20, or 40 minutes?
3. What operational impact level should an operator act on?

The product is designed as a calm, light-theme mission-operations console backed by a FastAPI service, reproducible offline replay, and interpretable detection, forecasting, and impact engines.

> **Project status — Operational Prototype & Verified Early-Warning Platform**
>
> The repository contains a fully verified v1 prototype implementation of the SURYAKAVACH solar-flare early-warning platform. It includes authentic Aditya-L1 PRADAN payload ingestion (SoLEXS, MAG) alongside HEL1OS/SUIT catalogue indexing, a hash-verified SQLite product registry, unit-aware 1-minute feature store, PyTorch discrete-time survival forecasting with graceful baseline fallback, calibration engines, live metrics API & evaluation panel, GitHub Actions CI workflow, and an operator runbook.

## Product scope

### Included in the v1 prototype

- **Multi-instrument Ingestion & Fusion:** Fused SoLEXS (soft X-ray), HEL1OS (hard X-ray), MAG (magnetic field vector), and SUIT (UV image) minute-level streams.
- **PRADAN Ingest & Cache Registry:** Command-line tool (`python -m suryakavach.ingest.cli`) for catalogue browsing and hash-verified product downloading.
- **Real-Time Nowcasting:** Changepoint detection (BOCPD) and Neupert-effect validation for flare onset/peak identification.
- **Calibrated Survival Forecasting:** PyTorch deep discrete-time survival model predicting hazard probabilities at 5, 10, 20, and 40 minute horizons, with automatic fallback to `DiscreteHazard` baseline if PyTorch DLLs or checkpoints are unavailable.
- **Explainable Impact Index:** 0–10 Flare Impact Index with R0–R5 aligned severity language and API-derived impact scale metadata (`/api/impact/scale`).
- **Live Metrics & Evaluation Dashboard:** `GET /api/metrics` endpoint and live `MetricsPanel.tsx` component displaying True Skill Statistic (TSS), Heidke Skill Score (HSS), Brier scores, lead time distributions, and reliability curves.
- **Historical Event Replay:** Offline, deterministic historical-event replay including the 22 February 2024 X6.3 event.
- **CI & Operational Runbook:** GitHub Actions workflow ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) and Operator Runbook ([`docs/runbook.md`](./docs/runbook.md)).

### Explicit non-goals for v1

- CME detection and Kp/geomagnetic-storm forecasting
- User accounts, access roles, and mobile apps
- Unbounded bulk archive scraping (PRADAN products are fetched on-demand per product ID)
- Webhook delivery (planned as a v1.1 stretch goal)

## Architecture

```text
Aditya-L1 (SoLEXS, HEL1OS, SUIT, MAG) / GOES data
        |
   ingestion + fusion (suryakavach.ingest)
        |
  feature store (Parquet / SQLite / Supabase)
        |
 +------+--------------------+
 |                           |
nowcast engine          forecast engine
BOCPD + Neupert         PyTorch Survival / DiscreteHazard
 |                           |
 +----------- impact engine --+
                 |
          FastAPI + WebSocket (/api, /ws/live)
                 |
     React + TypeScript operator dashboard (apps/web)
```

## Repository layout

```text
.github/workflows/ci.yml   GitHub Actions CI workflow for Python & TypeScript
backend/
  suryakavach/
    api.py                FastAPI routes, rate-limiting, and WebSocket endpoint
    runtime.py            Replay/runtime orchestration and engine boot
    db.py                 SQLite schema, Supabase shim, and evaluation run persistence
    config.py             Configuration loader
    splits.py             Leakage-safe date-disjoint split manifest loader
    engines/              BOCPD, Neupert, nowcast, forecast, calibration, impact
    evaluation/           TSS, HSS, FAR, Brier score, reliability curve metrics
    ingest/               PRADAN session, catalogue parser, registry, FITS/NetCDF readers
    models/               PyTorch discrete-time survival dataset, trainer, predictor
    evaluate.py           Evaluation CLI runner
  tests/                  15 test suites covering API, engines, ingestion, models, splits
config.yaml               Thresholds, horizons, impact weights, severity bands
data/
  registry/               SQLite observed product registry
  splits/                 Time-disjoint train/calibration/holdout manifest schema
docs/
  data-contract.md        Scientific data governance contract
  runbook.md              Operator runbook and credential rotation guide
docker-compose.yml        Local container orchestration
render.yaml               Render backend deployment config
apps/web/                 React + Vite frontend
  src/
    components/           MetricsPanel, ImpactGauge, FlareCatalogue, SolarScene
    lib/hooks.ts          useMetrics, useNowcast, useReplaySync React hooks
    types/api.ts          TypeScript interfaces and Zod validation schemas
  vercel.json             Vercel deployment config (rewrites to backend)
```

## Deployment

The production deployment runs:

- **Frontend** on **Vercel** — single-page app served statically, API/WebSocket calls rewritten to the backend.
- **Backend** on **Render** — Docker container running uvicorn.
- **Database** on **Supabase** — PostgreSQL with the `supabase` Python SDK.

### Prerequisites

- A Supabase project with `flares`, `alerts`, `replay_sessions`, and `evaluation_runs` tables created.
- Environment variables set in Render: `USE_SUPABASE=1`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## Local Development

### Prerequisites

- Python 3.11+
- Node.js 20+

### Backend Setup

```bash
cd backend
python -m venv .venv
# On Windows: .\.venv\Scripts\Activate.ps1
# On Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
pytest -v
uvicorn suryakavach.api:app --reload --port 8000
```

The API will be available at `http://localhost:8000`, with OpenAPI interactive docs at `/docs`.

### Frontend Setup

```bash
cd apps/web
npm install
npm run typecheck
npm test
npm run dev
```

The dashboard will be available at `http://localhost:5173`.

---

## API Contract

The SURYAKAVACH API uses UTC ISO-8601 timestamps and a `{ data, meta }` response envelope.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Service, data-timestamp, and engine readiness status |
| `GET /api/streams/latest?window=120` | Latest fused SoLEXS, HEL1OS, MAG stream window |
| `GET /api/nowcast/state` | Lifecycle state and active flare nowcast |
| `GET /api/flare/catalogue` | Filtered, paginated flare catalogue; CSV/JSON export |
| `GET /api/flare/{id}` | Full flare parameters, series, posterior, and sub-scores |
| `GET /api/forecast/horizons` | C1/M1 probabilities and horizon hazard predictions |
| `GET /api/impact/current` | Impact index, severity mapping, and contribution scores |
| `GET /api/impact/scale` | Centralized severity bands and dynamic impact weights |
| `GET /api/metrics` | Latest evaluation run metrics, lead-time distribution, reliability curve |
| `GET /api/metrics/{run_id}` | Historical evaluation run report by ID |
| `GET /api/alerts` | In-app alert feed |
| `POST /api/replay/start` / `stop` | Deterministic historical replay control |
| `WS /ws/live` | Live state, latest points, forecast, impact, alerts, and heartbeat |

---

## Data and Scientific Integrity

- **Source States:** All data products are categorized as `synthetic`, `observed_uncalibrated`, or `observed_calibrated` ([`docs/data-contract.md`](./docs/data-contract.md)).
- **Leakage Prevention:** Features at minute $t$ use only observations at or before $t$. Train/calibration/holdout splits are strictly date-disjoint.
- **Model Fallback:** If PyTorch C++ DLL libraries are missing or incompatible, the runtime transparently uses the interpretable `DiscreteHazard` baseline without throwing runtime errors.

---

## Team Ownership

| Area | Owner |
| --- | --- |
| Architecture, BOCPD, integration | Akshat Raj |
| Data ingestion, PRADAN cache, simulation stream, Docker | Akshat Raj |
| Survival model, EVT, calibration | Akshita Guleria |
| FastAPI, WebSockets, replay, alerts | Prerna |
| Dashboard, charts, accessibility | Pakhi |
| Validation, NOAA calibration, methodology, deck metrics | Mayank |

---

## License

License to be selected by the team before public release.
