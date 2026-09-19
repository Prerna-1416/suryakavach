# Coding Conventions

**Analysis Date:** 2026-09-19

## Overview

The repository is a two-language monorepo. `backend/pyproject.toml` defines a `[tool.ruff]` section specifying line length and selected rules (`select = ["E", "F", "I", "W"]`). Lint commands are not yet configured as package scripts, so developers should follow the observed code conventions by hand.


## Naming Patterns

**Files — Python:**
- Modules are `snake_case.py`: `backend/suryakavach/engines/bocpd.py`, `backend/suryakavach/ingest/pradan.py`, `backend/suryakavach/supabase_db.py`.
- Tests are `test_<subject>.py`: `backend/tests/test_api.py`, `backend/tests/test_engines.py`.

**Files — TypeScript/React:**
- React components are `PascalCase.tsx` and live under `apps/web/src/components/`: `apps/web/src/components/FlareCatalogue.tsx`, `apps/web/src/components/NowcastBanner.tsx`. UI primitives go in `components/ui/`: `apps/web/src/components/ui/Panel.tsx`.
- Non-component modules are `camelCase.ts`: `apps/web/src/lib/router.ts`, `apps/web/src/store/replayStore.ts`, `apps/web/src/types/api.ts`.
- Frontend tests are `<subject>.test.ts` / `<subject>.test.tsx` under `apps/web/src/test/`: `router.test.ts`, `FlareCatalogue.test.tsx`.

**Functions:**
- Python: `snake_case` — `compute_impact`, `run_nowcast`, `load_real_day_files`. Private helpers are `_`-prefixed — `_parse_flux_csv`, `_resample_minute`, `_client_ip`, `_clip`.
- TypeScript: `camelCase` — `parseLocation`, `catalogueUrl`, `useReplayControl`.

**Variables:**
- Python: `snake_case`; short math locals are acceptable (`cfg`, `cps`, `sxr`, `hxr`, `dh`, `pred`).
- TypeScript: `camelCase`; hooks are `use*` — `useStreams`, `useNowcast`, `useReplayControl`.

**Types:**
- TypeScript interfaces are `PascalCase` and mirror the backend JSON payloads exactly (`StreamsLatest`, `NowcastState`, `CatalogueData`). See `apps/web/src/types/api.ts`.
- Python: `PascalCase` classes; pydantic request models are `PascalCase` (`ReplayStart`, `CursorSet`, `ReplayControl`) in `backend/suryakavach/api.py`.

## Code Style

**Formatting:**
- **No formatter configured.** Do not introduce one casually; match surrounding style.
- Python: 4-space indent, double quotes, ~100-char lines, `from __future__ import annotations` as the first statement of **every** module (backend-wide, e.g. `backend/suryakavach/api.py:1`, `backend/suryakavach/engines/bocpd.py:1`, `backend/tests/conftest.py:1`).
- TypeScript: 2-space indent, single quotes, semicolons, trailing commas in multi-line literals.

**Linting:**
- **No linter configured.**
- TypeScript strictness is the effective gate. `apps/web/tsconfig.json` sets `"strict": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true`, `"noFallthroughCasesInSwitch": true`. `npm run typecheck` (`tsc -b --noEmit`) is the only automated static check.
- Python has no static checker; correctness rests on tests and review.

## Type Annotations

**Python — always annotate.** Signatures use modern `X | None` unions and built-in generics:
- `def load_real_day_files(day: str, src_dir: str | os.PathLike | None = None) -> dict:` (`backend/suryakavach/ingest/pradan.py`)
- `def _allowed_origins() -> list[str]:` (`backend/suryakavach/api.py`)
- `def _first_key(low: dict[str, str], candidates: tuple[str, ...]) -> str | None:`
- NumPy arrays are typed with `numpy.typing.NDArray`: `NDArray[np.float64] | None`.

**TypeScript — types over `any`.** API payloads are typed from `apps/web/src/types/api.ts` and consumed generically: `api.get<StreamsLatest>(...)`.

## Import Organization

**Python (`backend/`):**
1. `from __future__ import annotations`
2. stdlib imports, one-per-line, alphabetized (`import asyncio`, `import csv`, `import logging`, `import os`…)
3. third-party (`import numpy as np`, `from fastapi import ...`, `from pydantic import ...`)
4. local `suryakavach.*` imports (`from suryakavach.config import load_config`)
- Deferred imports are used deliberately inside functions to avoid circular/boot-cost issues — e.g. `from suryakavach.config import data_dir, load_config` inside `_default_real_dir` in `backend/suryakavach/ingest/pradan.py`.

**TypeScript (`apps/web/src/`):**
1. third-party packages (`react`, `framer-motion`, `lucide-react`, `@tanstack/react-query`)
2. `type`-only imports (`import type { CatalogueData } from '../types/api'`)
3. local relative imports

**Path Aliases:**
- `@/*` → `src/*` is configured in `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, and `apps/web/vitest.config.ts`. Note: **existing code overwhelmingly uses relative imports** (`../lib/api`, `../types/api`) rather than `@/`. Follow the surrounding file's prevailing style; relative imports are the de-facto standard.

**Exports:**
- React components use **default exports**: `export default function Panel(...)` (`apps/web/src/components/ui/Panel.tsx`), `export default function Header(...)`.
- Libraries/hooks/stores use **named exports**: `export function parseLocation(...)`, `export const useRouter = ...`, `export const useReplayStore = ...`.
- Python `__init__.py` files use an explicit `__all__` re-export list — see `backend/suryakavach/ingest/__init__.py`.

## Error Handling

**Python backend — custom exception types mapped to envelope responses.**
Domain exceptions are declared per module and translated by FastAPI exception handlers in `backend/suryakavach/api.py`:
- `RateLimited` → 429, `BadRequest` → 400, `NotReady` → 503 (with `Retry-After`), all returning the `{"data": None, "meta": {"error": ...}}` envelope.

```python
@app.exception_handler(BadRequest)
async def _br(_req, exc: BadRequest):
    return JSONResponse({"data": None, "meta": {"error": str(exc)}}, status_code=400)
```

Route bodies validate inputs and `raise BadRequest(...)` for domain 400s (`backend/suryakavach/api.py:262`, `:267`, `:328`). Pydantic `Field(ge=..., le=...)` constraints produce automatic 422s.

**Defensive fallback pattern (ingest):** the PRADAN adapter raises typed errors instead of tracebacks, and callers fall back rather than crash:

```python
class PradanUnavailable(RuntimeError):
    """Raised when official PRADAN data cannot be fetched (no auth / offline)."""
```
Callers catch specific exceptions and continue — `except (FileNotFoundError, OSError, ValueError): continue` in `backend/suryakavach/runtime.py:134`, and CSV parsing returns `None` on `except (OSError, UnicodeDecodeError)` in `backend/suryakavach/ingest/pradan.py`.

**Never crash the process:** `runtime.boot` records failures into `engine_status` and re-raises, but `/api/health` always answers "degraded" instead of the process dying (`backend/suryakavach/runtime.py:109`, `# pragma: no cover - defensive boot guard`). The async sim loop swallows per-tick exceptions with `log.exception("sim loop tick failed; continuing")` (`backend/suryakavach/api.py:206`).

**TypeScript frontend — typed error class + React Query state.**
`apps/web/src/lib/api.ts` defines `ApiError extends Error` with a `status` field, and the single `request<T>()` wrapper throws on transport failure or an in-envelope error:

```typescript
if (!res.ok) throw new ApiError(res.status, `API ${res.status}: ${res.statusText}`);
const json: Envelope<T> = await res.json();
if (json.meta?.error) throw new ApiError(500, json.meta.error);
return json.data;
```

Components do **not** wrap calls in try/catch; they read React Query's `isError`/`error` state (see `apps/web/src/components/ReplayBar.tsx:147` rendering `control.error?.message`). There is **no React ErrorBoundary** — a thrown render error is unhandled.

## Response Envelope Convention

Every HTTP response (success and error) uses the same envelope produced by `runtime.envelope` (`backend/suryakavach/runtime.py:254`):

```json
{ "data": <payload | null>, "meta": { "timestamp", "mode", "event_date", "cursor", "error?" } }
```

The TypeScript `Envelope<T>` interface in `apps/web/src/types/api.ts` mirrors this. When adding a route, return `runtime.envelope(...)`; when adding an error, return `{"data": None, "meta": {"error": "..."}}` with the matching status.

## Logging

**Framework:** Python stdlib `logging`. Each module declares a module-level logger, conventionally named `log`:
- `log = logging.getLogger("suryakavach.api")` (`backend/suryakavach/api.py`).
- `log.exception(...)` is used inside swallowed-exception blocks so failures are visible without crashing.

**Tailwind/UI:** no client-side logging framework; React Query handles fetch status.

## Comments

**When to Comment — comment the "why", heavily.** This codebase has an unusually high comment density, and comments explain rationale, trade-offs, and failure modes rather than restating code. Preserve this style:
- Inline rationale for magic numbers: `# speed N => N data-minutes per real minute → sleep 60/N seconds.` (`backend/suryakavach/api.py:190`).
- Explanation of a rejected simpler approach: the `BOCPD` class docstring in `backend/suryakavach/engines/bocpd.py` explains *why* `R[0]` is not used as the signal and derives the identity `cp / (cp + growth) == H`.
- Frontend JSX comments justify design/behavior: `{/* Mock fetch for catalogue tests */}`, chunk-splitting comments in `apps/web/vite.config.ts`.

**Docstrings:** Python uses triple-quoted docstrings on modules, classes, and non-trivial functions. A module-level docstring states the module's contract — see `backend/suryakavach/ingest/pradan.py`, whose top-of-file docstring documents both entry points and the offline fallback. Public functions carry a one-line summary plus, where useful, an explicit schema description (e.g. "Returns the exact day-dict schema … `{"ts", "solexs", "hel1os", "quality", "t0"}`").

**No JSDoc/TSDoc** in the frontend; short `//` comments are used instead (e.g. `// API response envelope` in `apps/web/src/types/api.ts`).

## Function Design

**Size:** Python engine functions are small and pure (`peak_sxr_score`, `hardness_score` in `backend/suryakavach/engines/impact.py`), with complex numerics isolated in classes (`BOCPD`, `DiscreteHazard`). Frontend components are larger and co-locate sub-components in the same file (e.g. `FlareDetailPane` inside `apps/web/src/components/FlareCatalogue.tsx`).

**Parameters:** Prefer explicit typed parameters over config objects for pure functions; pass a `cfg: dict` only where a whole config section is genuinely needed (`run_nowcast(sxr, hxr, cfg)`).

**Return Values:** Backend functions return plain dicts that match the API contract (e.g. `day` dict with fixed keys; impact returns a dict of subscores plus `index`). Frontend hooks return React Query results.

## Module Design

**State management:** Client state lives in Zustand stores (`apps/web/src/store/replayStore.ts`) and is read imperatively via `useReplayStore.getState()` inside helper callbacks (see `useReplaySync` in `apps/web/src/lib/hooks.ts`) when the caller should not subscribe to updates. Server state lives in React Query hooks in `apps/web/src/lib/hooks.ts`.

**Config access:** Backend configuration is read only through `load_config()` / `data_dir()` in `backend/suryakavach/config.py`, never by parsing YAML in place. `config.yaml` at the repo root is the single source; environment variables (`SURYAKAVACH_CONFIG`, `SURYAKAVACH_DATA`, `CORS_ORIGINS`, `CORS_ORIGIN_REGEX`) override it.

**Values that must stay in sync:** constants like replay cursor bounds and GOES thresholds live in `apps/web/src/lib/constants.ts` on the frontend and `config.yaml` + `backend/suryakavach/goes.py` on the backend. `test_replay_control_speeds_match_config` (`backend/tests/test_api.py`) exists specifically to assert the frontend-facing API accepts every speed `config.yaml` advertises — keep both sides updated together.

---

*Convention analysis: 2026-09-19*
