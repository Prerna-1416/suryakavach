# Technology Stack

**Analysis Date:** 2026-09-19

## Languages

**Primary:**
- Python 3.11 - Backend API, scientific engines, ingestion, and replay runtime. Pinned in `backend/Dockerfile` (`python:3.11-slim`) and required by `README.md` (Python 3.11+).
- TypeScript 5.7 - Operator console frontend. Config in `apps/web/tsconfig.json` (target ES2020, `moduleResolution: bundler`, `strict: true`, `noUnusedLocals`, `noUnusedParameters`).

**Secondary:**
- JavaScript (Node ESM) - Dev orchestration and tooling scripts in `scripts/dev.mjs` and `composio-mcp.ts`. Root `package.json` declares `"type": "module"`.
- GLSL - Inline shader strings for the WebGL hero, under `apps/web/src/components/three/` (`Sun.tsx`, `SolarWind.tsx`, `Earth.tsx`, `SolarScene.tsx`).

## Runtime

**Environment:**
- Node.js 20+ - Frontend build/runtime. Build stage uses `node:20-alpine` in `apps/web/Dockerfile`; `README.md` requires Node 20+.
- Python 3.11 - Backend runtime; served with `uvicorn suryakavach.api:app` (see `backend/Dockerfile`, `scripts/dev.mjs`).

**Package Manager:**
- npm - Two manifests: root workspace `package.json` (dev-orchestration only, no dependencies) and `apps/web/package.json`.
  - Lockfile: present at `apps/web/package-lock.json`. Root `package-lock.json` exists but is an empty stub (`"packages": {}`).
- pip - `backend/requirements.txt` pins every dependency exactly. No `poetry.lock`/`uv.lock`; `backend/pyproject.toml` holds both pytest configuration and `[tool.ruff]` lint settings.
  - Lockfile: missing (requirements are version-pinned instead).

## Frameworks

**Core:**
- FastAPI 0.115.6 - Backend HTTP API and WebSocket endpoint. App defined in `backend/suryakavach/api.py`; routes under `/api/*` and `WS /ws/live`.
- Uvicorn 0.34.0 (`[standard]`) - ASGI server. Bound to `127.0.0.1:8000` in dev (`scripts/dev.mjs`), `0.0.0.0:8000` in the container.
- PyTorch (torch >= 2.0.0) - Deep discrete-time survival model forecasting in `backend/suryakavach/models/` with CPU runtime expectations and `DiscreteHazard` baseline fallback.
- Pydantic 2.10.4 - Request models and validation (`ReplayStart`, `ReplayControl`, `CursorSet` in `backend/suryakavach/api.py`).
- React 18.3.1 + react-dom 18.3.1 - Frontend UI. Entry `apps/web/src/main.tsx`, root `apps/web/src/App.tsx`.
- Vite 7.3.6 - Dev server and bundler. Config `apps/web/vite.config.ts` (port 5173, `@` → `./src` alias, manual chunks for plotly/motion/vendor, `chunkSizeWarningLimit: 1200`).
- Tailwind CSS 4.0.0 via `@tailwindcss/vite` 4.0.0 - Styling pipeline; global styles `apps/web/src/index.css`.

**Testing:**
- pytest 8.3.4 - Backend tests. Config in `backend/pyproject.toml` (`pythonpath = ["."]`, `testpaths = ["tests"]`). Tests: `backend/tests/test_api.py`, `backend/tests/test_engines.py`, fixtures in `backend/tests/conftest.py`.
- Vitest 4.1.11 + jsdom 25.0.0 - Frontend unit tests. Config `apps/web/vitest.config.ts` (`environment: 'jsdom'`, `globals: true`, setup `./src/test/setup.ts`). Tests under `apps/web/src/test/`.
- Testing Library (`@testing-library/react` 16.1.0, `@testing-library/jest-dom` 6.6.0) - Component assertions.
- Playwright 1.49.0 - E2E. Config `apps/web/playwright.config.ts` (testDir `./e2e`, chromium only, baseURL `http://localhost:5173`, auto-starts `npm run dev`). Spec: `apps/web/e2e/console.spec.ts`.

**Build/Dev:**
- `tsc -b` - Typecheck + build step (`npm run build` = `tsc -b && vite build`); `npm run typecheck` = `tsc -b --noEmit`.
- Docker + Docker Compose - Local two-service stack in `docker-compose.yml` (`api` on 8000, `web` on 80:8080).
- Node `scripts/dev.mjs` - Single-command dev orchestration. `npm run dev` (both), `npm run dev:api`, `npm run dev:web`. Reuses already-listening ports and polls `http://127.0.0.1:8000/api/health` for backend readiness (45s timeout).
- No ESLint, Prettier, or Biome config detected anywhere in the repo.

## Key Dependencies

**Critical:**
- numpy 2.2.2, pandas 2.2.3, scipy 1.15.1 - Numerical core for the detection/forecast engines under `backend/suryakavach/engines/` (`bocpd.py`, `neupert.py`, `nowcast.py`, `forecast.py`, `evt.py`, `impact.py`).
- pyyaml 6.0.2 - Loads `config.yaml` in `backend/suryakavach/config.py`.
- supabase 2.10.0 - PostgREST client for the production datastore (`backend/suryakavach/supabase_db.py`). Requires `httpx<0.28`, which is why `httpx` is pinned to 0.27.2 in `backend/requirements.txt`.
- psycopg2-binary 2.9.10 - Postgres driver shipped alongside the Supabase SDK.
- `@react-three/fiber` 8.18.0, `@react-three/drei` 9.122.0, three 0.170.0, `@react-three/postprocessing` 2.19.1 - WebGL solar hero scene (`apps/web/src/components/three/`).
- `plotly.js-basic-dist-min` 2.35.0 + `react-plotly.js` 2.6.0 - Telemetry charts (`apps/web/src/components/TelemetryChart.tsx`, loader shim `apps/web/src/lib/plotly.ts` + `apps/web/src/types/plotly-basic.d.ts`). Deliberately isolated in its own Vite chunk.
- `@tanstack/react-query` 5.62.0 - Server-state data fetching (`apps/web/src/lib/hooks.ts`).
- zustand 5.0.0 - Client state (`apps/web/src/store/replayStore.ts`).
- zod 3.24.0 - Runtime schema validation in the frontend.
- `@tanstack/react-virtual` 3.11.0 - Virtualised catalogue list (`apps/web/src/components/FlareCatalogue.tsx`).

**Infrastructure:**
- clsx 2.1.1 - Conditional class names.
- framer-motion 11.18.2 - UI motion (`apps/web/src/lib/motion.ts`), own Vite chunk.
- lucide-react 0.474.0 - Icons.
- `@types/three` 0.170.0 (dependency, not devDependency), `@types/plotly.js`, `@types/react-plotly.js`, `@types/node` 26.4.1 - Type packages pinned under `apps/web/package.json` `devDependencies`.

## Configuration

**Environment:**
- Backend env vars read in code (names only):
  - `SURYAKAVACH_CONFIG` - path to config YAML, overrides default (`backend/suryakavach/config.py:13`).
  - `SURYAKAVACH_DATA` - overrides `data.cache_path` (`backend/suryakavach/config.py:19`).
  - `USE_SUPABASE` - `"1"` selects the Supabase shim over SQLite (`backend/suryakavach/db.py:305`).
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` - required when `USE_SUPABASE=1` (`backend/suryakavach/supabase_db.py:14`).
  - `CORS_ORIGINS` (comma-separated additions), `CORS_ORIGIN_REGEX` - extend `config.yaml` origins at runtime (`backend/suryakavach/api.py:44`).
  - `PORT` - container port, default 8000 (`backend/Dockerfile`).
- Frontend env vars (Vite `import.meta.env`, `apps/web/src/lib/constants.ts:152`):
  - `VITE_API_BASE` - defaults to `/api`.
  - `VITE_WS_URL` - defaults to same-origin `/ws/live`; set for production because Vercel rewrites do not proxy WebSocket upgrades.
  - Template: `apps/web/.env.example`; production values: `apps/web/.env.production` (present, contents not inspected). Root `.env` is present (gitignored) - contains local configuration.
- `config.yaml` (repo root) is the single tuning surface: BOCPD threshold/hazard/max run, Neupert correlation window, forecast horizons `[5, 10, 20, 40]`, impact weights, severity bands, replay defaults (event `2024-02-22`, speed 20), `data.cache_path: ./data`, `data.seed: 42`, `baseline.sxr_onset`, `rate_limit.requests_per_minute: 100`, and `cors_origins`.
- `composio-mcp.ts` reads `COMPOSIO_API_KEY` and `USER_ID` (not part of the app build; a standalone helper script using `dotenv`).

**Build:**
- `apps/web/tsconfig.json` (app) and `apps/web/tsconfig.node.json` (Vite config) with `tsc -b` project references.
- `apps/web/vite.config.ts` - manual chunk strategy: `plotly`, `motion`, `vendor`.
- `backend/Dockerfile`, `apps/web/Dockerfile` (multi-stage `node:20-alpine` → `nginx:alpine`), `.dockerignore`.
- `apps/web/vercel.json` - SPA rewrites plus `/api/*` → Render, `/ws/live` → `wss://`.
- `apps/web/nginx.conf` - SPA fallback, `/api/` and `/ws/` reverse proxy to `https://suryakavach-api.onrender.com`, 30-day immutable asset caching.

## Platform Requirements

**Development:**
- Python 3.11+ with `pip install -r backend/requirements.txt`.
- Node.js 20+ with `npm install` in `apps/web/`.
- Optional: Docker Desktop for the Compose path.
- Dev ports: backend `8000`, Vite `5173`; Vite proxies `/api` → `http://127.0.0.1:8000` and `/ws` → `ws://127.0.0.1:8000` (`apps/web/vite.config.ts`).

**Production:**
- Frontend: Vercel static SPA (`apps/web`, output `dist`); alternate container path serves `dist` via nginx on port 80.
- Backend: Render free-tier Docker web service (`render.yaml`, branch `master`, health check `/api/health`), container exposed on `8000`.
- Database: Supabase PostgreSQL (production) or local SQLite file `data/suryakavach.sqlite` (offline/demo).

---

*Stack analysis: 2026-09-19*
