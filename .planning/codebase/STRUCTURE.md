# Codebase Structure

**Analysis Date:** 2026-09-19

## Directory Layout

```text
suryakavach/
├── backend/                        # Python FastAPI service + engines
│   ├── suryakavach/                # The importable package (PYTHONPATH root)
│   │   ├── api.py                  # FastAPI app, routes, WS, middleware
│   │   ├── runtime.py              # Replay/engine orchestration singleton
│   │   ├── db.py                   # SQLite schema + Supabase REST shim
│   │   ├── supabase_db.py          # Supabase client factory
│   │   ├── config.py               # config.yaml + env loading, data_dir()
│   │   ├── goes.py                 # GOES class <-> flux helpers, iso()
│   │   ├── evaluate.py             # Offline metrics report generator
│   │   ├── engines/                # Pure numpy/scipy scientific engines
│   │   │   ├── bocpd.py            # Bayesian online changepoint detection
│   │   │   ├── nowcast.py          # FlareEvent / NowcastResult + run_nowcast
│   │   │   ├── neupert.py          # Neupert-effect correlation gate
│   │   │   ├── forecast.py         # rolling_features + DiscreteHazard
│   │   │   ├── evt.py              # GPD intensity quantiles
│   │   │   └── impact.py           # Impact index + severity banding
│   │   └── ingest/                 # Data ingestion adapters
│   │       ├── synthetic.py        # Deterministic synthetic day generator
│   │       └── pradan.py           # Real PRADAN product-file loader
│   ├── tests/                      # pytest suite
│   │   ├── conftest.py             # Session TestClient running lifespan
│   │   ├── test_api.py             # Route/contract tests
│   │   └── test_engines.py         # Engine unit tests
│   ├── data/                       # Dev SQLite cache (suryakavach.sqlite)
│   ├── reports/                    # Generated metrics.md
│   ├── Dockerfile                  # python:3.11-slim + uvicorn
│   ├── requirements.txt            # Pinned deps
│   └── pyproject.toml              # pytest config (pythonpath=["."], testpaths=["tests"])
├── apps/
│   └── web/                        # React 18 + Vite operator console
│       ├── src/
│       │   ├── main.tsx            # React root + QueryClientProvider
│       │   ├── App.tsx             # WS client + route -> screen switch
│       │   ├── index.css           # Tailwind v4 @theme design tokens
│       │   ├── components/         # Screens and feature panels
│       │   │   ├── three/          # WebGL landing hero (react-three-fiber)
│       │   │   └── ui/             # Presentational primitives
│       │   ├── hooks/              # Single-purpose React hooks
│       │   ├── lib/                # api, hooks (queries), router, constants, motion, plotly
│       │   ├── store/              # zustand replay store
│       │   ├── types/              # API response contracts
│       │   └── test/               # vitest unit/component tests
│       ├── e2e/                    # Playwright specs
│       ├── public/textures/        # Static WebGL textures
│       ├── vite.config.ts          # Dev proxy /api + /ws, manual chunks
│       ├── vitest.config.ts        # jsdom, @ alias
│       ├── playwright.config.ts    # Boots `npm run dev` on :5173
│       ├── tsconfig.json           # App TS config
│       ├── tsconfig.node.json      # Vite/config-file TS config
│       ├── Dockerfile              # Multi-stage build -> nginx:alpine
│       ├── nginx.conf              # SPA fallback + API/WS proxy
│       └── vercel.json             # /api + /ws rewrites to Render backend
├── scripts/
│   └── dev.mjs                     # Dev orchestrator (backend + frontend)
├── data/                           # Root SQLite cache (runtime default)
├── config.yaml                     # Single configuration surface
├── docker-compose.yml              # api + web services
├── render.yaml                     # Render Docker service (backend)
├── package.json                    # Root workspace scripts (dev/dev:api/dev:web)
├── .dockerignore / .gitignore
└── README.md                       # Product scope, layout, API contract, team
```

## Directory Purposes

**`backend/suryakavach/`:**
- Purpose: the entire server-side product as one importable Python package.
- Contains: FastAPI app, runtime orchestration, persistence, config, and the `engines/` and `ingest/` subpackages.
- Key files: `api.py`, `runtime.py`, `db.py`, `config.py`.

**`backend/suryakavach/engines/`:**
- Purpose: pure, testable scientific computation.
- Contains: one engine per file; no DB/HTTP/config-file access — each takes arrays plus the config dict.
- Key files: `bocpd.py` (changepoint detector), `nowcast.py` (flare lifecycle), `forecast.py` (hazard model), `impact.py` (scoring).

**`backend/suryakavach/ingest/`:**
- Purpose: convert raw sources into the canonical day dict.
- Contains: `synthetic.py` (offline fallback, seeded) and `pradan.py` (real product-file adapter).
- Key files: `synthetic.py:build_all_days`, `pradan.py:load_real_day_files`.

**`backend/tests/`:**
- Purpose: pytest suite. `conftest.py` provides a session-scoped `TestClient` that runs the app lifespan so engines boot before routes are hit.
- Contains: `test_api.py` (routes/envelope), `test_engines.py` (BOCPD, forecast, nowcast, GOES helpers, synthetic ingest).

**`apps/web/src/components/`:**
- Purpose: screen-level and panel-level React components, one file per named export default.
- Contains: screen panels (`TelemetryChart.tsx`, `ForecastCards.tsx`, `ImpactGauge.tsx`, `FlareCatalogue.tsx`, `AlertCentre.tsx`, `ReplayBar.tsx`, `NowcastBanner.tsx`, `MetricsPanel.tsx`, `About.tsx`), shell chrome (`NavBar.tsx`, `Header.tsx`, `LandingHero.tsx`).

**`apps/web/src/components/three/`:**
- Purpose: the WebGL landing hero, isolated from the console UI.
- Contains: `SolarScene.tsx` (Canvas + effects), `Sun.tsx`, `SolarWind.tsx`, `Earth.tsx`, `ParallaxCamera.tsx`, `textures.ts`.

**`apps/web/src/components/ui/`:**
- Purpose: reusable presentational primitives with no data fetching.
- Contains: `Panel.tsx`, `Metric.tsx`, `OrbitMark.tsx`, `Typewriter.tsx`.

**`apps/web/src/lib/`:**
- Purpose: non-component frontend logic.
- Contains: `api.ts` (fetch + envelope unwrap), `hooks.ts` (TanStack Query hooks + replay mutations), `router.ts` (zustand URL router), `constants.ts` (GOES/R-scale/weights/metrics/colors), `motion.ts` (framer-motion tokens), `plotly.ts` (single Plotly binding).

**`apps/web/src/store/`:**
- Purpose: client live state.
- Contains: `replayStore.ts` — zustand store for `mode/playing/speed/cursor/eventDate/dates`.

**`apps/web/src/types/`:**
- Purpose: hand-written TypeScript mirror of the backend response shapes.
- Contains: `api.ts` (all response interfaces), `plotly-basic.d.ts`, `vite-env.d.ts`.

**`apps/web/src/test/`:**
- Purpose: vitest unit and component tests (co-located under `src/`, not a parallel tree).
- Contains: `contract.test.ts` (Zod schemas validating API types), `constants.test.ts`, `router.test.ts`, `stores.test.ts`, `FlareCatalogue.test.tsx`, `setup.ts`.

**`scripts/`:**
- Purpose: developer tooling.
- Contains: `dev.mjs`, the single-command backend+frontend orchestrator.

**`data/` and `backend/data/`:**
- Purpose: SQLite caches. Runtime default is `config.yaml` `data.cache_path: ./data`, resolved relative to the process CWD.
- Generated: yes. Committed: no (`.gitignore`).

## Key File Locations

**Entry Points:**
- `scripts/dev.mjs`: dev orchestrator; spawns both servers, health-polls the API.
- `backend/suryakavach/api.py`: `app` ASGI object (`uvicorn suryakavach.api:app`).
- `backend/suryakavach/evaluate.py`: offline metrics CLI (`__main__`).
- `apps/web/src/main.tsx`: React root.
- `apps/web/src/App.tsx`: app shell, WS client, screen routing.

**Configuration:**
- `config.yaml`: thresholds, horizons, impact weights, severity bands, replay defaults, CORS, rate limit.
- `backend/suryakavach/config.py`: config + env resolution (`SURYAKAVACH_CONFIG`, `SURYAKAVACH_DATA`).
- `apps/web/vite.config.ts`: dev proxy `/api` and `/ws` → `127.0.0.1:8000`; `@` alias → `./src`.
- `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`: test runners.
- `apps/web/tsconfig.json` / `apps/web/tsconfig.node.json`: split app vs tooling TS configs.
- `docker-compose.yml`, `render.yaml`, `apps/web/vercel.json`, `apps/web/nginx.conf`: deployment.

**Core Logic:**
- `backend/suryakavach/runtime.py`: the `Runtime` class (single source of orchestration truth).
- `backend/suryakavach/engines/nowcast.py`: `run_nowcast`, `FlareEvent`, `NowcastResult`.
- `backend/suryakavach/engines/bocpd.py`: `BOCPD`.
- `backend/suryakavach/ingest/pradan.py`: `load_real_day_files`, `PradanUnavailable`.
- `apps/web/src/lib/hooks.ts`: all server-state queries/mutations.
- `apps/web/src/lib/constants.ts`: all display constants and thresholds.

**Testing:**
- `backend/tests/conftest.py`: session-scoped lifecycle-booting test client.
- `backend/tests/test_api.py`, `backend/tests/test_engines.py`.
- `apps/web/src/test/*.test.ts(x)`, `apps/web/e2e/console.spec.ts`.

## Naming Conventions

**Python files/modules:**
- `snake_case.py`, one concept per module: `runtime.py`, `supabase_db.py`, `nowcast.py`.
- Package entry points use `__init__.py` purely for re-exports (`engines/__init__.py`, `ingest/__init__.py` list `__all__`).

**Python symbols:**
- Classes: `PascalCase` (`Runtime`, `BOCPD`, `DiscreteHazard`, `FlareEvent`, `NowcastResult`, `_SupaWrapper`).
- Functions/methods: `snake_case` (`run_nowcast`, `compute_impact`, `_build_preferred_days`).
- Private helpers: leading underscore (`_ffill`, `_finalize`, `_nowcast_until`, `_broadcast`, `_emit_alert`).
- Module-level singletons: lowercase (`runtime`, `log`, `cfg` in `api.py`).
- Domain exceptions: `PascalCase` ending in the condition (`PradanUnavailable`, `RateLimited`, `NotReady`, `BadRequest`).
- Constants: `UPPER_SNAKE` (`MINUTES_PER_DAY`, `MAX_ALERTS`, `FEATURE_NAMES`, `GOES_THRESHOLDS`, `CLASS_RANK`, `SCHEMA`).

**TypeScript/React files:**
- Components: `PascalCase.tsx`, file name matches the default export (`TelemetryChart.tsx`, `NowcastBanner.tsx`); WebGL components live under `three/`.
- Hooks/logic: `camelCase.ts` (`hooks.ts`, `router.ts`, `plotly.ts`); the zustand store is `replayStore.ts` (camelCase + `Store` suffix).
- Types: `types/api.ts` (domain-named file, interfaces inside).
- Entry/style: `main.tsx`, `App.tsx`, `index.css` (framework conventions).

**TypeScript symbols:**
- Components/types/interfaces: `PascalCase` (`FlareCatalogue`, `StreamsLatest`, `ReplayControlBody`).
- Hooks: `useX` (`useStreams`, `useReplayControl`, `usePrefersReducedMotion`).
- Functions/values: `camelCase` (`goesClass`, `rLevel`, `parseLocation`, `catalogueUrl`).
- Constants: `UPPER_SNAKE` (`SERIES_COLORS`, `REPLAY`, `RISK_THRESHOLDS`, `METRICS`).
- Boolean predicates: `isX` / `hasX` (`isModifiedClick`).

**Tests:**
- Python: `test_<subject>.py` under `backend/tests/`, functions `test_<behaviour>()`.
- Frontend unit/component: `<subject>.test.ts` or `<PascalComponent>.test.tsx` under `apps/web/src/test/`.
- e2e: `<area>.spec.ts` under `apps/web/e2e/`.

**Directories:**
- Python packages: lowercase (`engines`, `ingest`, `suryakavach`).
- Frontend: lowercase plural by role (`components`, `hooks`, `lib`, `store`, `types`, `test`); sub-groupings by domain (`three`, `ui`).
- Repo-level: `backend/`, `apps/web/`, `scripts/`, `data/` (monorepo-ish split: one API service, one web app).

## Where to Add New Code

**New engine (detection/forecast/scoring):**
- Implementation: `backend/suryakavach/engines/<name>.py` — pure functions/classes taking numpy arrays and the config dict; no DB or HTTP.
- Register: re-export from `backend/suryakavach/engines/__init__.py`.
- Wire in: call it from `backend/suryakavach/runtime.py` (boot or a runtime method) and shape its output there.
- Tests: add to `backend/tests/test_engines.py`.
- Config: add tunables to `config.yaml` and read them via `self.cfg["<section>"]` — do not hardcode thresholds in the engine.

**New ingestion source:**
- Implementation: `backend/suryakavach/ingest/<source>.py` returning the day dict `{"ts","solexs","hel1os","quality","t0"}`.
- Register: re-export from `backend/suryakavach/ingest/__init__.py`; consume from `Runtime._build_preferred_days()` (`runtime.py:122`).
- Tests: add to `backend/tests/test_engines.py` (synthetic-style) or a new `backend/tests/test_ingest.py`.

**New API endpoint:**
- Route: add to `backend/suryakavach/api.py`, guarded by `require_ready()` for data routes, returning `runtime.envelope(...)`.
- Logic: put the computation on `Runtime` in `backend/suryakavach/runtime.py`; the route should only validate and delegate.
- DB access: if it needs a new query shape, extend both `_sqlite_connect` and the `_SupaWrapper` patterns in `backend/suryakavach/db.py:149` and add a test.
- Tests: add to `backend/tests/test_api.py` (the session `client` fixture in `conftest.py` runs the real lifespan).

**New frontend screen:**
- Component: `apps/web/src/components/<Screen>.tsx`.
- Route: add the name to `Screen` + `KNOWN_SCREENS` in `apps/web/src/lib/router.ts`, then a `case` in the `renderScreen()` switch in `apps/web/src/App.tsx`.
- Data: add a query hook in `apps/web/src/lib/hooks.ts` using `api.get<T>(...)`; mirror the response shape in `apps/web/src/types/api.ts`.
- Test: a `<Screen>.test.tsx` in `apps/web/src/test/` and, for navigation, a case in `apps/web/e2e/console.spec.ts`.

**New UI primitive:**
- Implementation: `apps/web/src/components/ui/<Name>.tsx` (no data fetching).

**New API-facing constant:**
- Prefer deriving it from the server response. If it must be static, put it in `apps/web/src/lib/constants.ts` and annotate its backend source (see `METRICS.provenance`).

**Shared helpers:**
- Backend: module-level `_`-prefixed functions inside the consuming module, or `backend/suryakavach/goes.py` for flare-class/time helpers.
- Frontend: `apps/web/src/lib/` (`constants.ts` for values, `motion.ts` for animation recipes).

## Special Directories

**`apps/web/dist/` and `apps/web/dist-tsconfig-node/`:**
- Purpose: Vite build output and TS build info.
- Generated: Yes. Committed: No.

**`apps/web/playwright-report/` and `apps/web/test-results/`:**
- Purpose: Playwright HTML report and traces/screenshots.
- Generated: Yes. Committed: No.

**`apps/web/public/textures/`:**
- Purpose: texture assets loaded by `components/three/textures.ts`.
- Generated: No. Committed: Yes.

**`backend/.pytest_cache/`, `__pycache__/`:**
- Purpose: tool caches.
- Generated: Yes. Committed: No.

**`.kilo/worktrees/`:**
- Purpose: tool-managed git worktree copy of the repo (contains a full duplicate of `apps/web`).
- Generated: Yes. Committed: No. Do not treat as source.

---

*Structure analysis: 2026-09-19*
