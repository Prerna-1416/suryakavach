# External Integrations

**Analysis Date:** 2026-09-19

## APIs & External Services

**Space-weather data sources:**
- ISRO PRADAN / ISSDC (Aditya-L1 SoLEXS + HEL1OS L1 products) - Primary intended upstream data source for real observations.
  - SDK/Client: No SDK; hand-rolled file reader in `backend/suryakavach/ingest/pradan.py` (`csv.DictReader`, optional FITS naming convention).
  - Auth: The official high-cadence products sit behind the authenticated PRADAN/ISSDC data-access flow (account + session cookie). No credential env var is wired yet - `fetch_pradan_day()` currently raises `PradanUnavailable` (see `backend/suryakavach/ingest/pradan.py:118-132`).
  - Operational path today: cached product files dropped on disk at `<data.cache_path>/real_days/<YYYY-MM-DD>/` (CSV named `solexs*sxr*.csv` / `hel1os*hxr*.csv`, or `.fits`), consumed by `load_real_day_files()`. `Runtime._build_preferred_days()` in `backend/suryakavach/runtime.py:122-136` prefers real days over synthetic when that directory exists.
  - Fallback: synthetic generator `backend/suryakavach/ingest/synthetic.py` (`build_all_days`, seeded by `data.seed: 42`).
- NOAA GOES XRS classification - Represented only as local unit-scale logic, not a live feed. `backend/suryakavach/goes.py` implements `goes_class()` (A/B/C/M/X bands), `class_letter()`, `class_meets_min()`, and `iso()`. No HTTP fetch to NOAA exists.
  - README (`README.md:214-219`) lists cached GOES XRS and NOAA flare-event data as a required future ingestion target, not a present integration.

**MCP / tooling (non-runtime):**
- Composio - Standalone helper `composio-mcp.ts` (repo root) imports `@composio/core`, creates an MCP session, and prints the MCP URL + headers.
  - Auth: `COMPOSIO_API_KEY` (env, via `dotenv`); optional `USER_ID` (defaults to `"default-user"`).
  - Not imported by the app build; `package.json` at root declares no dependencies for it.

**Typed client surfaces:**
- Backend REST + WebSocket contract consumed by the frontend through `apps/web/src/lib/api.ts` (fetch wrapper adding `Content-Type: application/json`, unwrapping the `{ data, meta }` envelope, throwing `ApiError`).
- Base URL resolution: `API_BASE` from `VITE_API_BASE` (default `/api`); `WS_URL` from `VITE_WS_URL` (default same-origin `/ws/live`) in `apps/web/src/lib/constants.ts:152-159`.

## Data Storage

**Databases:**
- Production: Supabase (hosted PostgreSQL) accessed through the `supabase` Python SDK's PostgREST interface.
  - Connection: `SUPABASE_URL`; auth via `SUPABASE_SERVICE_ROLE_KEY`.
  - Client factory: `backend/suryakavach/supabase_db.py` (`create_client`, module-level singleton with `reset_supabase()`).
  - Selected when `USE_SUPABASE=1` in `backend/suryakavach/db.py:302-307`.
  - Tables: `flares`, `alerts`, `replay_sessions` (DDL for both stores is in `backend/suryakavach/db.py`; README `README.md:101-139` documents the Postgres variant, including `"end"` as a reserved-word quoted column).
  - Query translation: `_SupaWrapper` in `backend/suryakavach/db.py:174-295` pattern-matches the fixed set of SQL statements emitted by `runtime.py` and re-issues them as PostgREST calls - any new SQL shape raises `ValueError: Unsupported SQL for Supabase shim`. Catalogue reads use an explicit `limit(5000)` (`_CATALOGUE_MAX_ROWS`) because PostgREST caps unbounded selects at 1000 rows.
  - Write batching: `batch_flares()` / `flush_flares()` buffer flare upserts into 200-row chunks to avoid ~115 sequential HTTP round-trips at boot (`backend/suryakavach/db.py:190-201`).
- Offline/dev: SQLite via Python's stdlib `sqlite3` at `<data.cache_path>/suryakavach.sqlite` (default `./data/suryakavach.sqlite`; file exists at both `data/` and `backend/data/`). Concurrency handled by `_LockedConnection` with a re-entrant lock and `check_same_thread=False` (`backend/suryakavach/db.py:62-126`).

**File Storage:**
- Local filesystem only. Ingested/cached JSON day payloads live under `<data.cache_path>`; real product files under `<data.cache_path>/real_days/<day>/`. Docker Compose bind-mounts `./data:/data` and `./config.yaml:/app/config.yaml:ro` (`docker-compose.yml`). SQLite also carries a `raw_files` table (filename, payload, date, sha256) for ingested raw payloads.

**Caching:**
- No external cache service. Deterministic on-disk cache + `data.seed` in `config.yaml` provide replay reproducibility.

## Authentication & Identity

**Auth Provider:**
- None for end users. README explicitly lists "User accounts, access roles, and mobile apps" as v1 non-goals.
- The only credential in play is the Supabase service-role key used server-side.
- API protection is a per-IP in-process rate limiter (not auth): `rate_limit()` in `backend/suryakavach/api.py:80-92`, limit `rate_limit.requests_per_minute: 100` from `config.yaml`, bucket ceiling `_MAX_BUCKETS = 4096` with stale-bucket sweeping, keyed on `request.client.host`.

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry/Datadog/Rollbar integration detected.

**Logs:**
- Python stdlib `logging` - module logger `suryakavach.api` (`backend/suryakavach/api.py:28`). The sim loop logs and swallows per-tick exceptions so one bad tick cannot kill the replay stream.
- Health endpoints: `GET /api/health` reports service, data timestamp, and per-engine status (`nowcast`/`forecast`/`impact`, initialised `"starting"` in `backend/suryakavach/runtime.py:70-74`). Used as the Docker Compose healthcheck and the Render `healthCheckPath`, and polled by `scripts/dev.mjs`.
- OpenAPI docs served by FastAPI at `/docs` (README `README.md:170`).

## CI/CD & Deployment

**Hosting:**
- Backend: Render - free-tier Docker web service `suryakavach-api`, defined in `render.yaml` (`branch: master`, `dockerfilePath: backend/Dockerfile`, `dockerContext: .`, health check `/api/health`).
- Frontend: Vercel - static SPA from `apps/web` (build `npm run build`, output `dist`); live at `https://suryakavach.vercel.app/`.
- Alternate frontend hosting: nginx container (`apps/web/nginx.conf`) listening on port 80, mapped to host 8080 in `docker-compose.yml`.
- Local full stack: `docker compose up` builds both services; `web` waits on `api` via `depends_on: condition: service_healthy`.

**CI Pipeline:**
- Configured via `.github/workflows/ci.yml`. Triggers on push and pull-request to `main` and `master`. Executes `backend-test` (Python 3.11 `pytest`) and `frontend-test` (Node.js 20 `npm run typecheck` and `npm test` with Vitest).


## Environment Configuration

**Required env vars:**
- Backend: `SURYAKAVACH_CONFIG`, `SURYAKAVACH_DATA` (optional path overrides); `USE_SUPABASE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required together when `USE_SUPABASE=1`); `CORS_ORIGINS`, `CORS_ORIGIN_REGEX` (optional CORS extensions); `PORT` (container, default 8000).
- Frontend: `VITE_API_BASE`, `VITE_WS_URL`.
- Tooling: `COMPOSIO_API_KEY`, `USER_ID` (`composio-mcp.ts`).
- Docker Compose forwards `USE_SUPABASE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` with defaults (`0` / empty) and sets `SURYAKAVACH_CONFIG=/app/config.yaml`, `SURYAKAVACH_DATA=/data`.

**Secrets location:**
- Local: root `.env` (present, gitignored), `apps/web/.env.production` (present, gitignored) - variable names only were inspected, no values.
- Production: Render dashboard env vars (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are declared `sync: false` in `render.yaml`, i.e. set in the dashboard, never committed).
- `.gitignore` excludes `.env`, `.env.local`, `*.sqlite`, `*.db`, `models/*.pt`, and `.claude/`.

**CORS (required for cross-origin deployments):**
- `config.yaml` `cors_origins` allows `http://localhost:5173`, `http://localhost:8080`, `http://127.0.0.1:5173`, `http://127.0.0.1:8080`, `https://suryakavach.vercel.app`.
- Applied in `backend/suryakavach/api.py:37-52` + middleware at `api.py:132-139`; credentials are disabled and methods limited to `GET`, `POST`, `OPTIONS`.

## Webhooks & Callbacks

**Incoming:**
- None. No webhook receivers exist; README lists webhook delivery as a v1.1 stretch goal (`README.md:35`).

**Outgoing:**
- None. The backend never calls out to third-party APIs at runtime today; all external data access is filesystem-based (see PRADAN section above).

**Client-facing push (not a webhook):**
- `WS /ws/live` - server-pushed live state, latest points, forecast, impact, alerts, and heartbeat, broadcast to connected operator consoles (`backend/suryakavach/api.py`, `Runtime.ws_clients` in `backend/suryakavach/runtime.py:62`).
- Third-party CDN: Google Fonts (`https://fonts.googleapis.com` / `https://fonts.gstatic.com`) is linked from `apps/web/index.html:12-14` (Cormorant Garamond, Inter, JetBrains Mono) - the only external browser-side network dependency.

---

*Integration audit: 2026-09-19*
