# Testing Patterns

**Analysis Date:** 2026-09-19

## Test Framework

**Backend — pytest:**
- `pytest==8.3.4` (pinned in `backend/requirements.txt`).
- Config: `backend/pyproject.toml` — `pythonpath = ["."]`, `testpaths = ["tests"]`. Running pytest from `backend/` puts the package on `sys.path` automatically.
- Uses `fastapi.testclient.TestClient` (ships with FastAPI; no extra dependency).

**Frontend — Vitest:**
- `vitest@^4.1.11` with `@testing-library/react@^16` and `@testing-library/jest-dom@^6`.
- Config: `apps/web/vitest.config.ts` — `globals: true`, `environment: 'jsdom'`, `setupFiles: './src/test/setup.ts'`, `css: false`, include `src/**/*.{test,spec}.{ts,tsx}`.

**E2E — Playwright:**
- `@playwright/test@^1.49.0`. Config: `apps/web/playwright.config.ts` — `testDir: './e2e'`, chromium only, `retries: 1`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, HTML + list reporters.

**Assertion Library:**
- Backend: plain `assert` statements (pytest style) — no `unittest`, no custom matchers.
- Frontend: `expect` from Vitest plus jest-dom matchers (`toBeInTheDocument`, `toBeVisible`) loaded globally via `apps/web/src/test/setup.ts` (which contains only `import '@testing-library/jest-dom';`).

**Run Commands:**
```bash
# Backend (from backend/)
pytest                                   # run all backend tests

# Frontend (from apps/web/)
npm test                                 # vitest (watch mode)
npx vitest run                           # single non-watch run
npm run test:e2e                         # playwright test

# Only automated static gate in the repo
npm run typecheck                        # tsc -b --noEmit
```

## Test File Organization

**Location:**
- Backend: separate `backend/tests/` directory, flat. Files: `conftest.py`, `test_api.py`, `test_engines.py`.
- Frontend: separate `apps/web/src/test/` directory (NOT co-located with components). Files: `setup.ts`, `constants.test.ts`, `contract.test.ts`, `router.test.ts`, `stores.test.ts`, `FlareCatalogue.test.tsx`.
- E2E: `apps/web/e2e/console.spec.ts`.

**Naming:**
- Backend: `test_<subject>.py`; test functions `test_<behavior>` (e.g. `test_goes_class`, `test_replay_control_validation`).
- Frontend: `<subject>.test.ts[x]`; `describe('<unit>')` + `it('<behavior>')`.

## Test Structure

**Backend — shared session fixture with lifespan boot.** `backend/tests/conftest.py` exposes a single session-scoped `client` fixture. It uses `with TestClient(app) as c` specifically because engines boot in the FastAPI lifespan handler; a bare `TestClient(app)` would leave the runtime unbooted and every route would answer 503.

```python
@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
```

Tests are grouped by concern rather than strict one-file-per-module: `test_api.py` covers HTTP + WebSocket routes, `test_engines.py` covers detectors/forecast/impact/goes helpers directly with NumPy inputs.

**Frontend — `describe`/`it` with explicit `beforeEach` resets.** Stores are reset by replacing state wholesale:

```typescript
beforeEach(() => {
  useReplayStore.setState({
    mode: 'live', playing: false, speed: 20, cursor: 0,
    eventDate: '2024-02-22', dates: [],
  });
});
```

Component tests wrap the unit in required providers via a local helper:

```typescript
function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
```

**Assertion patterns:**
- Backend asserts the envelope shape on every route: `assert "data" in json_data`, then field-level checks (`test_api.py`).
- Frontend uses role/text queries, not CSS selectors: `screen.getByRole('link', { name: 'ALL' })`, `screen.findByText(/No flare events matching/i)`.

## Mocking

**Backend:**
- **No mocking library is used.** Tests exercise the real runtime end-to-end through `TestClient`; the app boots on synthetic data (seed 42, `config.yaml` → `data.seed`). There is no `unittest.mock`/`pytest-mock` anywhere in `backend/tests/`.
- Network calls are effectively neutralised by design rather than by mocks: `fetch_pradan_day` always raises `PradanUnavailable` in the current implementation (`backend/suryakavach/ingest/pradan.py`), and the runtime prefers on-disk `real_days/` directories, falling back to synthetic days. So the tests never touch the network.
- The WebSocket is tested through TestClient's in-process transport, not a live server:

```python
def test_ws_live(client):
    with client.websocket_connect("/ws/live") as websocket:
        data = websocket.receive_json()
        assert "clock" in data or "nowcast_state" in data
```

**Frontend — stub `global.fetch`:**
- **No MSW / no `vi.mock` of modules.** The one HTTP-mocking pattern is a module-level `vi.fn()` assigned to `global.fetch`, reset in `beforeEach`:

```typescript
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.resetAllMocks();
  mockFetch.mockResolvedValue({
    ok: true, status: 200, statusText: 'OK',
    json: async () => ({ data: { items: [], page: 1, page_size: 50, total: 0 },
                         meta: { timestamp: '', mode: '', event_date: '', cursor: '' } }),
  });
});
```

- The "loading state" test overrides it with a never-resolving promise: `mockFetch.mockReturnValue(new Promise(() => {}));`.

**What to Mock:**
- Frontend network calls at the `fetch` boundary only.
- Frontend must return the full `{ data, meta }` envelope from the mock because `apps/web/src/lib/api.ts` unwraps `json.data` and reads `json.meta.error`.

**What NOT to Mock:**
- Backend engines, runtime, and routes — they are tested against real synthetic data and a real booted runtime.
- Pure frontend logic (`router`, `constants`, `store`) — tested directly with no mocking.

## Fixtures and Factories

**Backend:**
- Only fixture is `client` in `backend/tests/conftest.py`.
- Engine tests build inputs inline with `np.random` and fixed literals rather than shared factories, e.g. a changepoint test constructs `np.concatenate([np.random.normal(0, 0.1, 50), np.random.normal(5, 0.1, 50)])` and asserts the windowed statistic separates the baseline from the shift (`test_bocpd`).
- Ingest tests use the deterministic synthetic generator with an explicit seed: `build_all_days(seed=42)`.

**Frontend — typed fixtures in `contract.test.ts`:**
- `apps/web/src/test/contract.test.ts` declares Zod schemas mirroring each `apps/web/src/types/api.ts` interface, then a set of typed fixture objects (`fixtureStreams: StreamsLatest`, `fixtureNowcast`, `fixtureCatalogue`, …). Each `describe` asserts the schema **accepts** the valid fixture and **rejects** a malformed variant (missing field, bad enum). This is the de-facto API contract test suite and the place to add a fixture when a payload shape changes.
- Note the deliberate honest assertion in the CatalogueData test: the malformed `{ items: [], total: 5 }` case is documented as *not* semantically enforced (`// schema doesn't enforce semantic consistency`) and is asserted `not.toThrow()`. Keep this honesty — do not turn it into a passing-but-meaningless check.

## Coverage

**Requirements:** None enforced. No coverage tooling is configured (`pytest-cov` is not in `backend/requirements.txt`; no Vitest coverage provider or thresholds). `.gitignore` lists `.coverage`/`htmlcov/` but nothing generates them in-repo, and there are no CI workflows (`.github/workflows/` does not exist).

**View Coverage:**
```bash
# Not configured. To measure ad hoc:
pytest --cov=suryakavach          # requires installing pytest-cov
npx vitest run --coverage         # requires installing @vitest/coverage-v8
```
The only coverage-style marker in the source is a single `# pragma: no cover - defensive boot guard` at `backend/suryakavach/runtime.py:109`.

## Test Types

**Unit Tests:**
- Backend: `backend/tests/test_engines.py` tests pure engine functions directly — `goes_class`/`class_letter`/`class_meets_min` (`backend/suryakavach/goes.py`), `BOCPD.run`, `DiscreteHazard.fit/predict`, `run_nowcast`, `catalogue_injections`/`build_all_days`.
- Frontend: `constants.test.ts` (threshold/colour mapping in `apps/web/src/lib/constants.ts`), `router.test.ts` (`parseLocation`/`catalogueUrl` in `apps/web/src/lib/router.ts`), `stores.test.ts` (`useReplayStore` clamping logic), `contract.test.ts` (Zod contracts).

**Integration Tests:**
- Backend: effectively all of `backend/tests/test_api.py` — real FastAPI app, real booted runtime, real SQLite persistence, real WebSocket. Covers `/api/health`, `/api/streams/latest`, `/api/nowcast/state`, the catalogue JSON/CSV/detail/404 paths, forecast/impact, replay start/pause/resume/cursor/stop, the unified `/api/replay/control` state machine, its 400/422 validation, and the WS `/ws/live` handshake.
- Frontend: `FlareCatalogue.test.tsx` renders the real component inside a real React Query provider against a stubbed `fetch`.

**E2E Tests:**
- `apps/web/e2e/console.spec.ts` (Playwright, chromium). `webServer.command` is `npm run dev` (Vite only) — **the backend is not started by the Playwright config.** The specs assert only UI shell/static behaviour: the WebGL canvas attaches, nav links and headings render, client-side routing/deep links/back-forward work, the skip-to-content link works, and ReplayBar/toolbar + Export CSV controls are present. They do **not** assert on live API data, so they pass whether or not the backend is up.

## Common Patterns

**Deterministic data:** backend tests rely on `config.yaml`'s `data.seed: 42` and pass `seed=42` explicitly, so synthetic days are reproducible. Preserve determinism in replay mode (see README Contributing).

**Threshold/boundary testing:** numeric logic is asserted at boundaries, not just mid-range — `rLevel` checks `1.9 → R0` and `2 → R1`; `goesClass` checks each class floor; `test_bocpd` asserts `np.mean(around_shift) > np.mean(baseline) * 5` rather than a bare `> 0`, with a comment explaining why a weaker check would pass on a broken detector.

**Parameterized validation matrix:** `test_replay_control_validation` asserts a table of rejections in one test — missing param → 400, unknown action / out-of-range speed / out-of-range cursor → 422.

**Round-trip / config-coupling tests:** `test_catalogue_endpoints` fetches a flare id from the JSON list and reuses it for the detail and CSV assertions; `test_replay_control_speeds_match_config` reads `load_config()["replay"]["speeds"]` and asserts the API accepts every advertised value.

**Async (frontend):** loading and empty states are asserted with `findBy*` (awaited) so React Query's async resolution is handled, e.g. `await screen.findByText(/No flare events matching/i)`.

**Vitest globals:** `globals: true` is configured, but every test file still imports explicitly (`import { describe, it, expect, beforeEach, vi } from 'vitest';`). Follow that explicit-import style.

## Coverage Situation and Gaps (honest assessment)

The suite is **meaningful but narrow**. Concrete gaps:

1. **`backend/suryakavach/ingest/pradan.py` has no tests.** `grep -rln pradan backend/tests` returns nothing. This is the real-data ingestion path and the highest-risk untested module: CSV headers are matched leniently (`_first_key` tries `ts/time/t/date/datetime/iso_ts` and `flux/value/sxr/hxr/intensity/...`), rows can be skipped silently, and `_resample_minute`/`_ffill` carry numeric edge cases (all-NaN, out-of-range timestamps, unsorted input). A first test here should cover: a well-formed CSV round-trips into the 1440-length day dict; unknown/missing columns yield `None`; unsorted timestamps are sorted; `fetch_pradan_day` raises `PradanUnavailable`; `load_real_day_files` raises `FileNotFoundError` when the directory is absent (so runtime falls back to synthetic).
2. **No evaluation/backtest tests.** `backend/suryakavach/evaluate.py` and the metrics report are not covered, yet README quality gates depend on reproducible metrics.
3. **No tests for `backend/suryakavach/db.py`** beyond what the API tests indirectly exercise (the Supabase shim's `_catalogue` and the `_LockedConnection` locking are untested directly).
4. **WebSocket coverage is a handshake only** (`test_ws_live`) — no assertion of frame contents, broadcast fan-out, or backpressure/drop-oldest behaviour in `_broadcast`.
5. **E2E never runs the backend**, so no end-to-end data path (ingest → engine → API → UI) is verified in CI-suitable form.
6. **No CI at all** (`.github/workflows/` absent), so none of the above runs automatically on push. The README's "add a test with every bug fix" rule is currently enforced by convention only.

**When adding tests, match these patterns:** pytest `assert` + the session `client` fixture for backend; Vitest explicit imports + jsdom + `renderWithProviders` + stubbed `global.fetch` for frontend; extend the typed fixtures/Zod schemas in `contract.test.ts` rather than duplicating payload shapes.

---

*Testing analysis: 2026-09-19*
