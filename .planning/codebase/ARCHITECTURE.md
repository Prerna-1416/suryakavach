<!-- refreshed: 2026-09-19 -->
# Architecture

**Analysis Date:** 2026-09-19

## System Overview

SURYAKAVACH is a solar-flare nowcast / forecast / impact prototype for Aditya-L1 (SIH26209). It is a deterministic, replay-driven pipeline: a single in-process `Runtime` holds one day of minute-resolution SoLEXS/HEL1OS telemetry at a time, runs a set of numpy/scipy engines over it, and serves the resulting state to a React operator console over REST + WebSocket.

```text
┌────────────────────────────────────────────────────────────────────┐
│  Frontend — React 18 + Vite operator console                       │
│  `apps/web/src/main.tsx` → `apps/web/src/App.tsx`                  │
│  route switch `apps/web/src/lib/router.ts` (zustand)               │
│  server state `apps/web/src/lib/hooks.ts` (TanStack Query)         │
│  live state   `apps/web/src/store/replayStore.ts` (zustand)        │
└───────────┬──────────────────────────────────┬─────────────────────┘
            │ REST /api/* (poll)               │ WS /ws/live (push)
            ▼                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│  API layer — FastAPI                                              │
│  `backend/suryakavach/api.py`  (routes, middleware, lifespan)     │
│  `_sim_loop` advances cursor + `_broadcast` fans frames to WS      │
└───────────────────────────┬────────────────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│  Runtime / orchestration — single process singleton               │
│  `backend/suryakavach/runtime.py`  (`runtime = Runtime(boot=False)`)│
│  boot(): build days → fit forecast → run nowcasts → persist flares │
│  tick(): advance cursor → emit alerts → assemble live payload      │
└───────────┬────────────────────────────────┬───────────────────────┘
            ▼                                ▼
┌──────────────────────────────┐  ┌─────────────────────────────────┐
│  Engines (pure numpy)        │  │  Persistence                    │
│  `backend/suryakavach/engines/`│ │  `backend/suryakavach/db.py`    │
│  bocpd / neupert / nowcast   │  │  sqlite OR Supabase REST shim   │
│  forecast / evt / impact     │  │  tables: flares, alerts,        │
└───────────┬──────────────────┘  │  replay_sessions, raw_files     │
            ▲                     └─────────────────────────────────┘
            │ day dict {"ts","solexs","hel1os","quality","t0"}
┌───────────┴────────────────────────────────────────────────────────┐
│  Ingestion & Feature Store                                         │
│  `backend/suryakavach/ingest/synthetic.py`  synthetic generator    │
│  `backend/suryakavach/ingest/pradan_session.py` Keycloak auth      │
│  `backend/suryakavach/ingest/pradan_catalogue.py` catalogue/down   │
│  `backend/suryakavach/ingest/registry.py`   raw products DB        │
│  `backend/suryakavach/ingest/fits_products.py` FITS readers       │
│  `backend/suryakavach/ingest/magnetometer.py` MAG NetCDF4 reader   │
│  `backend/suryakavach/ingest/fusion.py`     minute alignment       │
│  `backend/suryakavach/ingest/feature_store.py` Parquet partition   │
└────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| API app | HTTP routes, WS endpoint, CORS, rate limiting, lifespan boot, sim-loop fan-out | `backend/suryakavach/api.py` |
| Runtime | Owns replay cursor/speed, day cache, engine state, alert emission, all response shaping | `backend/suryakavach/runtime.py` |
| Config | Loads `config.yaml` + env overrides; resolves data dir | `backend/suryakavach/config.py` |
| Persistence | SQLite schema + thread-safe connection, or Supabase REST shim | `backend/suryakavach/db.py` |
| Supabase client | Lazy singleton `create_client` | `backend/suryakavach/supabase_db.py` |
| GOES helpers | Flare class <-> flux, ISO formatting | `backend/suryakavach/goes.py` |
| BOCPD engine | Bayesian online changepoint detection (windowed posterior) | `backend/suryakavach/engines/bocpd.py` |
| Nowcast engine | Changepoint + Neupert + jump detection → `FlareEvent` list | `backend/suryakavach/engines/nowcast.py` |
| Neupert engine | SXR derivative vs cumulative HXR correlation gate | `backend/suryakavach/engines/neupert.py` |
| Forecast engine | Feature extraction + discrete-time logistic hazard | `backend/suryakavach/engines/forecast.py` |
| EVT engine | GPD tail fit → intensity quantiles q50/q90/q99 | `backend/suryakavach/engines/evt.py` |
| Impact engine | 0–10 weighted impact index + severity banding | `backend/suryakavach/engines/impact.py` |
| Synthetic ingest | Deterministic 1440-sample day generator with injected flares | `backend/suryakavach/ingest/synthetic.py` |
| PRADAN ingest | Real product-file loader + best-effort fetcher stub | `backend/suryakavach/ingest/pradan.py` |
| Evaluation | Evaluation execution, metrics computation (TSS/HSS/FAR/Brier), run persistence, and dashboard metrics API | `backend/suryakavach/evaluate.py`, `backend/suryakavach/evaluation/` |
| Dev orchestrator | Boots/tears down uvicorn + Vite, reuses live ports | `scripts/dev.mjs` |
| Frontend shell | Provider setup, WS client, route → screen switch | `apps/web/src/App.tsx`, `apps/web/src/main.tsx` |
| API client | `{data,meta}` envelope unwrap → throws `ApiError` | `apps/web/src/lib/api.ts` |
| Query hooks | Polling queries + replay mutations with cache invalidation | `apps/web/src/lib/hooks.ts` |
| URL router | Deep-linkable screens in a zustand store | `apps/web/src/lib/router.ts` |

## Pattern Overview

**Overall:** Layered pipeline with a single mutable in-process runtime singleton ("replay engine"), consumed by a stateless HTTP/WS API and a client-side SPA.

**Key Characteristics:**
- **Replay over live:** the system replays cached/synthetic 1-minute bars on a simulated clock; there is no real-time ISSDC streaming in v1.
- **Causality-preserving reads:** every read is truncated to `runtime.cursor` rather than reading whole-day results (see `_nowcast_until` / `_flare_public(prefix=True)`).
- **Pure-function engines:** `engines/*` take numpy arrays + the config dict and return dataclasses; they never touch the DB or the cursor.
- **Config-driven:** every scientific threshold lives in `config.yaml`, loaded once into `Runtime.cfg`.
- **Dual persistence backend:** the same `execute(sql, params)` call surface is implemented by local SQLite or a Supabase REST shim, selected by `USE_SUPABASE`.

## Layers

**Ingestion layer:**
- Purpose: Produce the canonical "day dict" the engines and runtime consume.
- Location: `backend/suryakavach/ingest/`
- Contains: Synthetic generator (`synthetic.py`), real-data adapter (`pradan.py`), package re-exports (`__init__.py`).
- Depends on: numpy, `suryakavach.goes`, `suryakavach.config`.
- Used by: `runtime._build_preferred_days()`, `evaluate.evaluate()`, tests.

**Engines layer:**
- Purpose: Turn two 1440-sample flux arrays into flares, probabilities, and an impact index.
- Location: `backend/suryakavach/engines/`
- Contains: `bocpd.py`, `neupert.py`, `nowcast.py`, `forecast.py`, `evt.py`, `impact.py`, re-exports in `__init__.py`.
- Depends on: numpy, scipy only. No DB, no HTTP, no config I/O (config is passed in).
- Used by: `runtime` (nowcast, forecast, impact, evt), `evaluate`.

**Runtime / orchestration layer:**
- Purpose: Hold state, sequence the engines, enforce replay causality, emit alerts, shape API payloads.
- Location: `backend/suryakavach/runtime.py`
- Contains: the `Runtime` class and the module-level singleton `runtime = Runtime(boot=False)`.
- Depends on: engines, ingest, db, goes, config.
- Used by: `api.py` exclusively.

**API layer:**
- Purpose: Expose runtime state as REST + WS with the `{data, meta}` envelope.
- Location: `backend/suryakavach/api.py`
- Contains: FastAPI `app`, middleware, exception handlers, route functions, `_sim_loop`, `_broadcast`, `_ws_drain`.
- Depends on: `runtime`, `config`, `goes`.
- Used by: browser, Playwright e2e, backend tests.

**Frontend layer:**
- Purpose: Operator console UI.
- Location: `apps/web/src/`
- Contains: `components/` (screens + panels), `components/three/` (WebGL hero), `components/ui/` (primitives), `lib/` (api, hooks, router, constants, motion, plotly), `store/` (replay state), `types/` (API contracts).
- Depends on: the API layer only, via `/api/*` and `/ws/live`.

## Data Flow

### Primary Request Path (REST poll)

1. TanStack Query hook fires, e.g. `useStreams` in `apps/web/src/lib/hooks.ts:19` → `api.get('/api/streams/latest?window=…')`.
2. `request()` in `apps/web/src/lib/api.ts:12` fetches and unwraps `json.data`.
3. FastAPI route in `backend/suryakavach/api.py` calls `require_ready()` then a runtime method, e.g. `runtime.streams_latest(window)` (`api.py:238`).
4. `Runtime.streams_latest()` (`runtime.py:280`) slices `day["timestamps"]` to `[cursor-window+1 .. cursor]`, calls `_nowcast_until(cursor)` (`runtime.py:335`) for a causal event slice, and assembles `solexs`/`hel1os` points, flare shades, changepoints where `posterior >= cfg.bocpd.threshold`, and data gaps.
5. `runtime.envelope(data)` (`runtime.py:254`) wraps as `{data, meta:{timestamp, mode, event_date, cursor}}` and FastAPI serialises it.

### Live Push Path (WebSocket)

1. On startup the lifespan handler (`api.py:115`) stores the running loop, runs `runtime.boot()` in a worker thread (`asyncio.to_thread`), then spawns `_sim_loop()`.
2. `_sim_loop()` (`api.py:177`) sleeps `60/speed` seconds (interruptible via `runtime.speed_changed`), then calls `runtime.tick()` off the event loop.
3. `Runtime.tick()` (`runtime.py:736`) advances `cursor`, emits latched alerts (`data_gap`, `flare_onset`, `flare_peak`, `severity_increase`, `forecast_high`), and returns a full payload.
4. `_broadcast(payload)` (`api.py:210`) puts the frame on every client queue, dropping the oldest frame under backpressure.
5. `ws_live()` (`api.py:387`) sends `runtime.live_snapshot()` on connect, then forwards queued frames, emitting a heartbeat every 30 s.
6. `App.tsx:100` `ws.onmessage` writes clock/cursor/playing/speed into `useReplayStore`; charts re-render from polled REST data.

### Boot Path

1. `lifespan` → `Runtime.boot()` (`runtime.py:92`).
2. `_build_preferred_days()` (`runtime.py:122`): `synthetic.build_all_days(seed)` then overlays any real days from `<cache_path>/real_days/<day>/` via `pradan.load_real_day_files`.
3. `_fit_forecast()` (`runtime.py:140`): builds rolling feature vectors every 5 min per day with 20-min labels, fits `DiscreteHazard`.
4. `_run_all_nowcasts()` (`runtime.py:164`): `run_nowcast` per day → `nowcast_by_day`, attaches EVT quantiles `day["evt"]`.
5. `_persist_flares()` (`runtime.py:177`): clears `flares`, computes impact/severity, bulk-upserts (batched under Supabase).
6. Boot failures are captured in `engine_status`/`boot_error` and surfaced by `/api/health` rather than crashing the process.

### Replay Control Path

`ReplayBar` → `useReplayControl` (`apps/web/src/lib/hooks.ts:125`) → `POST /api/replay/control` → `api.replay_control()` (`api.py:376`) → `Runtime.control()` (`runtime.py:702`) → returns canonical `replay_state()`; the hook writes it into the store and invalidates cursor-dependent queries (`CURSOR_DEPENDENT_KEYS`, `hooks.ts:102`).

**State Management:**
- Server-side: single `Runtime` instance; all mutation under `self.lock` (an `RLock`).
- Client-side: zustand stores — `store/replayStore.ts` for live replay state, `lib/router.ts` for the URL-derived route; TanStack Query owns server state and polling.
- Persistence: `flares`, `alerts`, `replay_sessions`, `raw_files` tables, written during boot and tick.

## Key Abstractions

**Day dict** (the central data contract between ingest and everything else):
- Purpose: one day of minute-resolution telemetry on a common grid.
- Produced by: `ingest/synthetic.py:build_day()` and `ingest/pradan.py:load_real_day_files()`.
- Shape: `{"ts": np.ndarray[datetime], "solexs": ndarray, "hel1os": ndarray, "quality": ndarray[int8], "t0": datetime}` plus optional `"truth"` (injected flares, synthetic only) and `"evt"` (intensity quantiles).
- Consumers: every engine and most runtime methods.

**FlareEvent / NowcastResult** (`backend/suryakavach/engines/nowcast.py:14`):
- Purpose: one detected flare and its lifecycle; `NowcastResult` bundles the full-day posterior + event lists.
- Pattern: mutable dataclass finalised by `_finalize()`; rejected candidates kept with `state="rejected"` until filtered.

**Envelope** (`backend/suryakavach/runtime.py:254`, mirrored in `apps/web/src/types/api.ts:2`):
- Purpose: uniform `{data, meta}` response; errors are reported as `meta.error` with a matching HTTP status via exception handlers.

**Connection abstraction** (`backend/suryakavach/db.py:302`):
- Purpose: `connect(path)` returns SQLite (`_LockedConnection`) or Supabase (`_SupaWrapper`), both exposing `execute/commit/executemany/executescript`.
- Pattern: `_SupaWrapper` regex-matches the exact SQL strings runtime.py emits and translates each to a PostgREST call; anything unmatched raises `ValueError`.

**BOCPD** (`backend/suryakavach/engines/bocpd.py:7`):
- Purpose: online changepoint detection over `log10(sxr)`.
- Key detail: exposes `P(run length <= cp_window)`, not `R[0]` — because with a constant hazard `R[0]` always normalises to the hazard and carries no information. This is documented in the class docstring.

**PRADAN adapter** (`backend/suryakavach/ingest/pradan.py:44`):
- Purpose: read official SoLEXS/HEL1OS product files (CSV or FITS) into the day-dict schema, tolerating varied column names (`ts/time/t/date/datetime/iso_ts`) and resampling to a 1440-minute grid.
- Boundary: `fetch_pradan_day()` is an explicit stub raising `PradanUnavailable`; the system never fabricates real data — synthetic remains the offline fallback.

## Entry Points

**Dev orchestrator:**
- Location: `scripts/dev.mjs`
- Triggers: `npm run dev` / `dev:api` / `dev:web` (root `package.json`).
- Responsibilities: probe ports 8000/5173, spawn `python -m uvicorn suryakavach.api:app` from `backend/` and `npm run dev -- --port 5173` from `apps/web/`, poll `/api/health`, and SIGTERM all children on exit.

**Backend server:**
- Location: `backend/suryakavach/api.py` → `app` (ASGI).
- Triggers: uvicorn (`scripts/dev.mjs`, `backend/Dockerfile`, `render.yaml`).
- Responsibilities: boot runtime off the event loop, serve REST + WS, enforce rate limits/CORS.

**Frontend:**
- Location: `apps/web/src/main.tsx` → `apps/web/src/App.tsx`.
- Triggers: Vite dev server (`apps/web/vite.config.ts`) or the built `dist/` served by `apps/web/nginx.conf` / Vercel.
- Responsibilities: mount providers, open the WS, render the routed screen.

**Offline evaluation:**
- Location: `backend/suryakavach/evaluate.py` (`if __name__ == "__main__"`).
- Triggers: `python -m suryakavach.evaluate` from `backend/`.
- Responsibilities: regenerate `backend/reports/metrics.md` from the synthetic cache.

**Tests:**
- Backend: `backend/tests/` (pytest; `conftest.py` session client runs the app lifespan).
- Frontend unit: `apps/web/src/test/` (vitest + jsdom).
- Frontend e2e: `apps/web/e2e/console.spec.ts` (Playwright, boots Vite).

## Architectural Constraints

- **Threading:** one `Runtime` shared between the asyncio event loop and FastAPI's threadpool. Engine work is CPU-bound and dispatched via `asyncio.to_thread` (`api.py:121`, `api.py:201`). All runtime state mutation is guarded by `Runtime.lock` (`threading.RLock`); DB access is guarded by the connection's own `RLock`.
- **Global state:** `runtime` singleton (`runtime.py:842`); `api._buckets` rate-limit map (`api.py:30`); `supabase_db._client` lazy client (`supabase_db.py:8`); `lib/router.ts` installs a `popstate` listener at module load.
- **Spotify-style singleton import:** importing `runtime.py` instantiates `Runtime(boot=False)`, which resolves configuration and initializes SQLite tables without fitting forecast models or running heavy data loading; full boot happens during the FastAPI lifespan.
- **Determinism:** replay must be reproducible — synthetic data is seeded (`config.data.seed`), `DiscreteHazard.__init__` seeds numpy with 7.
- **Causality:** no API response may expose post-cursor information; reads use `_nowcast_until` and the `prefix=True` recomputation path.
- **Circular imports:** none observed; `pradan._default_real_dir` imports `config` lazily inside the function to avoid an ingest→config→ingest cycle.
- **No ORM:** raw SQL strings in `runtime.py` are the query surface; the Supabase shim depends on their exact text.

## Anti-Patterns

### Coupling persistence to exact SQL text

**What happens:** `_SupaWrapper._execute()` (`backend/suryakavach/db.py:203`) regex-matches the literal SQL emitted by `runtime.py` (e.g. `_RE_CATALOGUE_SELECT`). Any new query or whitespace change in `runtime.py` raises `ValueError: Unsupported SQL for Supabase shim` at runtime.
**Why it's wrong:** a backend-agnostic-looking `connect()` hides a brittle string contract; the failure only appears in the Supabase deployment path.
**Do this instead:** add a matching pattern *and* a test in `backend/tests/` when adding a query, or route new reads through a named repository method. Prefer keeping new queries within the existing patterns listed in `db.py:149-171`.

### Duplicated scientific constants on the client

**What happens:** `apps/web/src/lib/constants.ts:59` defines `IMPACT_WEIGHTS` as `{peak_sxr:0.35, hardness:0.25, impulsivity:0.20, duration:0.20}`, while the authoritative `config.yaml` uses `{0.35, 0.25, 0.15, 0.15}` (duration `0.15`). `METRICS` (`constants.ts:118`) is hand-transcribed from `backend/reports/metrics.md`.
**Why it's wrong:** the UI can display weights/severity that disagree with what the backend actually computed.
**Do this instead:** read these from an API endpoint (the `constants.ts:113` comment already flags the missing `/api/metrics`), or derive display values from the server response rather than duplicating them.

### Two sources of truth for severity scaling

**What happens:** severity bands live in `config.yaml` `severity_bands` (applied by `engines/impact.py:map_severity`) and again as `R_SCALE` in `apps/web/src/lib/constants.ts:35` with different edges (`max: 2/4/6/8/9/10` vs the backend's `2/4/6/8/10.01`).
**Why it's wrong:** client-side recolouring can bucket an index differently from the server's `r_level`.
**Do this instead:** render the server's `severity_band` / `r_level` fields directly; use `R_SCALE` only as a fallback palette.

## Error Handling

**Strategy:** domain exceptions mapped to HTTP statuses at the API boundary; engine/boot failures degrade rather than crash.

**Patterns:**
- Domain exceptions `RateLimited`, `BadRequest`, `NotReady` (`api.py:98-108`) have registered handlers returning the `{data,meta}` envelope with 429/400/503.
- `require_ready()` guards every data route; unbooted engines return 503 + `Retry-After: 5`.
- Boot is defensive: exceptions are written to `engine_status`/`boot_error` and re-raised, so `/api/health` reports `degraded` (`runtime.py:265`).
- `_sim_loop` swallows per-tick exceptions, logs, and sleeps 1 s (`api.py:205`).
- Frontend: `ApiError` (`apps/web/src/lib/api.ts:3`) is thrown on non-OK or `meta.error`; WS reconnect uses exponential backoff capped at 30 s (`App.tsx:116`).

## Cross-Cutting Concerns

**Logging:** stdlib `logging` in `api.py` only (`logging.getLogger("suryakavach.api")`); engines and runtime are silent. `PYTHONUNBUFFERED=1` in Docker/dev so logs stream.
**Validation:** Pydantic models (`ReplayStart`, `CursorSet`, `ReplayControl` in `api.py:55-67`) + `Query(...)` constraints; regex date validation via `_DATE_RE`; frontend re-validates response shapes with Zod in `apps/web/src/test/contract.test.ts`.
**Authentication:** none — the API is unauthenticated and relies on rate limiting (`rate_limit`, 100 req/min default) and CORS allow-lists (`_allowed_origins`, `_origin_regex`).
**Configuration:** `config.yaml` at repo root is the single surface, overridden by `SURYAKAVACH_CONFIG` (path) and `SURYAKAVACH_DATA` (cache dir); `CORS_ORIGINS` / `CORS_ORIGIN_REGEX` extend origins without a rebuild (`config.py:12`).
**Persistence switch:** `USE_SUPABASE=1` selects the Supabase shim; otherwise a local SQLite file under `data.cache_path`.

---

*Architecture analysis: 2026-09-19*
