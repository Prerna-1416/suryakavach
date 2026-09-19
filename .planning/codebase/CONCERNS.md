# Codebase Concerns

**Analysis Date:** 2026-09-19

## Tech Debt

**Supabase SQL shim is regex-matched and has no test coverage:**
- Issue: `backend/suryakavach/db.py` implements `_SupaWrapper` by matching a fixed set of SQL strings against compiled regexes (`_RE_FLARES_UPSERT`, `_RE_ALERTS_SELECT`, `_RE_CATALOGUE_SELECT`, etc. at `backend/suryakavach/db.py:150-171`) and by re-parsing the query text a second time for filters (`_catalogue` inspects `sql.upper()` for literal substrings like `"ONSET >="` at `backend/suryakavach/db.py:280-295`). Any change to the SQL emitted from `backend/suryakavach/runtime.py` silently falls through to `raise ValueError("Unsupported SQL for Supabase shim")` (`backend/suryakavach/db.py:255`) at runtime, with no type or lint check linking the two files.
- Files: `backend/suryakavach/db.py`, `backend/suryakavach/runtime.py`
- Impact: `backend/tests/conftest.py` boots with `USE_SUPABASE` unset (defaults to `0`), so every test exercises the SQLite path. `render.yaml` sets `USE_SUPABASE: "1"` for production — the entire production persistence path is unexecuted by the test suite.
- Fix approach: Add a fake-Supabase integration test that runs `runtime.boot()` + `tick()` against `_SupaWrapper`, or replace the regex shim with an explicit repository interface (`upsert_flare`, `list_alerts`, `delete_alerts`) that both backends implement.

**Alert pruning is silently disabled on the production backend:**
- Issue: `Runtime._prune_alerts` wraps its `DELETE FROM alerts WHERE id NOT IN (...)` in `except Exception: pass` (`backend/suryakavach/runtime.py:609-626`), with a comment acknowledging the Supabase shim has no pattern for that statement and will raise. The shim indeed has no `_RE_` for it.
- Files: `backend/suryakavach/runtime.py:609-626`, `backend/suryakavach/db.py:207-255`
- Impact: With `USE_SUPABASE=1`, `MAX_ALERTS` (`backend/suryakavach/runtime.py:52`) is never enforced; the alerts table grows without bound on every `tick()`, and `SELECT * FROM alerts ... LIMIT 100` (`backend/suryakavach/db.py:227-232`) scans an ever-larger table.
- Fix approach: Add a pattern handler for the prune statement in the shim, or add an explicit `prune_alerts(keep)` method to both connection classes and call that instead of raw SQL.

**Two divergent `_ffill` implementations:**
- Issue: `backend/suryakavach/runtime.py:26-44` and `backend/suryakavach/ingest/pradan.py:228-240` each define a NaN forward-fill with the same name but different semantics. The runtime version only checks `np.isnan`; the pradan version checks `np.isnan(y[i]) or not np.isfinite(y[i])` and uses `last if last > 0 else fill`. A third copy is inlined into `backend/suryakavach/evaluate.py:34-44`.
- Files: `backend/suryakavach/runtime.py`, `backend/suryakavach/ingest/pradan.py`, `backend/suryakavach/evaluate.py`
- Impact: The runtime filler passes `inf` values through untouched (see Fragile Areas), while callers assume "filled" means finite.
- Fix approach: Extract one `ffill_finite(x, floor)` into a shared module and import it in all three places.

**Dead / orphan code:**
- `Runtime._persist_flares` contains `ev.id if ev.detection_method != "threshold" else ev.id` — both ternary branches are identical (`backend/suryakavach/runtime.py:211`).
- `backend/suryakavach/ingest/pradan.py:118-132`: `fetch_pradan_day` is a stub that unconditionally raises, yet its docstring describes a fetch-and-delegate behavior that does not exist. No `TODO` marker flags it.
- `composio-mcp.ts` (repo root, tracked): imports `@composio/core` and `dotenv`, neither of which is declared in `package.json` (`composio-mcp.ts:1-2`). It is excluded from the Docker build via `.dockerignore` and would fail immediately if run.

**DOS-formatted line endings in a tracked source file:**
- `backend/suryakavach/ingest/evt.py:1` begins with a UTF-8 BOM. Harmless at runtime but signals the file was edited on Windows without a consistent encoding, and it breaks tools that parse the shebang/`from __future__` line strictly.

## Known Bugs

**PRADAN timestamp array can be misaligned with its data (uncommitted work-in-progress):**
- Symptoms: `load_real_day_files` buckets each sample by minute-of-day using `d` (the calendar day at midnight) as the origin — `sxr = _resample_minute(ts, vals, d)` at `backend/suryakavach/ingest/pradan.py:82` and `:91`, where `_resample_minute` computes `idx = int((t - t0).total_seconds() // 60)` (`pradan.py:212`). But the returned timeline is built from the *first sample* timestamp: `"ts": _minute_ts(t0)` where `t0 = datetime.fromtimestamp(t0_stamp, tz=UTC)` and `t0_stamp` is `ts[0].timestamp()` (`pradan.py:80-81, 94-95, 110, 222-225`).
- Trigger: Any real product file whose first sample is not at 00:00 UTC. If the first sample is at, say, 10:00, the value for minute 10:00 is stored at index 600 but is labelled with timestamp `t0 + 600 min = 20:00`.
- Files: `backend/suryakavach/ingest/pradan.py:75-115, 204-225`
- Impact: Every downstream engine (BOCPD, Neupert, forecast, alert timestamps, flare `onset_idx`/`peak_idx` persisted to the DB) sees data whose labels are shifted. The bug is invisible when sample files happen to start at midnight, which is why it can survive review.
- Workaround: none.
- Fix approach: Use a single time origin. Either pass `t0` (first sample) into `_resample_minute` and keep `_minute_ts(t0)`, or pass `d` into both and label `ts` from `d`. A regression test with a first sample at a non-midnight time would pin this.

**FITS input is accepted by the file-existence check but never parsed:**
- Symptoms: `load_real_day_files` globs `solexs*sxr*.fits` / `hel1os*.fits` and uses them to satisfy the "has product files" guard (`pradan.py:67-70`), then iterates `for p in sxr_paths or sxr_fits:` but only enters the body for `if p.suffix == ".csv"` (`pradan.py:75-92`). A `.fits` path is therefore skipped, leaving `sxr`/`hxr` as `None`.
- Trigger: A `real_days/<day>/` directory containing only FITS products (the docstring at `pradan.py:53-54` claims FITS is supported).
- Files: `backend/suryakavach/ingest/pradan.py:53-54, 67-102`
- Impact: The function does not raise (the guard passed) and instead silently substitutes the constant baselines `6e-8` / `4e-10` (`pradan.py:99-102`) — an operator would see a plausible-looking flat day rather than an error.
- Fix approach: Either implement FITS reading or remove the FITS globs and docstring so the unmet format raises `FileNotFoundError`.

**`scripts/dev.mjs` can exit with code 0 on a fatal port conflict (uncommitted work-in-progress):**
- Symptoms: `shutdown` ends with `setTimeout(() => process.exit(exitCode), 500).unref()` (`scripts/dev.mjs:29`). The timer is unref'd, so it does not keep the event loop alive. On the port-conflict path (`scripts/dev.mjs:119-122`) no child process has been spawned yet (`procs` is empty), so once `shutdown` returns there is nothing pending: Node drains the event loop and exits with its default status 0 before the timer fires.
- Files: `scripts/dev.mjs:22-34, 115-134`
- Impact: The intended non-zero exit for "port 8000 occupied by a foreign process" is lost; a CI or wrapper script checking `$?` sees success even though nothing started. The same path also does not `return` after `shutdown`, so execution falls through into the web-server block at `scripts/dev.mjs:136-143`.
- Fix approach: Call `process.exit(exitCode)` synchronously after killing children (or guard the fall-through with an early `return`), rather than relying on an unref'd timer.

**WebSocket reconnect loop survives component unmount:**
- Symptoms: `ws.onclose` unconditionally schedules `setTimeout(connectWS, reconnectRef.current)` with no attempt limit (`apps/web/src/App.tsx:116-120`). The effect cleanup only calls `wsRef.current?.close()` (`App.tsx:127-130`), which fires `onclose` and schedules another connection.
- Files: `apps/web/src/App.tsx:90-130`
- Impact: In dev, React 18 StrictMode double-mounts the effect, and any remount (route/screen change) leaves a timer that opens a new socket after teardown; those sockets are never closed, so each remount adds a permanent live WS client. Server-side, `runtime.ws_clients` (`backend/suryakavach/runtime.py:61`) is a plain `set` with no cap.
- Fix approach: Track the reconnect timer id in a ref and clear it in the cleanup; also stop scheduling once the component is unmounted.

## Security Considerations

**Remote CSV ingest parses untrusted fields without validation:**
- Risk: `_parse_flux_csv` (`backend/suryakavach/ingest/pradan.py:145-178`) reads an externally sourced file and:
  - `low = {k.lower().strip(): v for k, v in row.items()}` at `pradan.py:162` will raise `AttributeError` when `csv.DictReader` yields the `None` key (a row with more fields than the header) — the standard malformed-CSV case.
  - `fv = float(v)` at `pradan.py:168` catches only `ValueError`; a missing column yields `v is None` and raises an uncaught `TypeError`.
  - `ts.append(_parse_dt(k))` at `pradan.py:173` is outside any `try`, and `_parse_dt` raises `ValueError` for any unrecognised format (`pradan.py:194`).
- Files: `backend/suryakavach/ingest/pradan.py:145-201`, `backend/suryakavach/runtime.py:122-138`
- Current mitigation: `Runtime._build_preferred_days` wraps the load in `except (FileNotFoundError, OSError, ValueError): continue` (`backend/suryakavach/runtime.py:132-137`). That catches the `ValueError` from a bad timestamp but **not** the `AttributeError`/`TypeError` above.
- Recommendations: Guard `row.items()` against `None` keys, wrap the `float(v)` and `_parse_dt` calls per-row, and either widen the runtime catch to `Exception` with a logged warning or make the parser return `None` for a malformed row instead of raising. Note that widening the catch alone would introduce silent fallback (see Fragile Areas).

**Rate limiting is keyed on the socket peer, not the forwarded client:**
- Risk: `_client_ip` returns `request.client.host` only (`backend/suryakavach/api.py:70-71`). Behind the Vercel/Render proxy that terminates TLS, every request arrives from the same proxy address, so all users share a single `_buckets` entry.
- Files: `backend/suryakavach/api.py:30-34, 70-95`
- Current mitigation: `_MAX_BUCKETS = 4096` caps memory growth (`api.py:34, 84-88`). The comment at `api.py:31-34` describes defending against spoofed `X-Forwarded-For`, but the code never reads that header, so the comment does not match the implementation.
- Recommendations: Decide explicitly whether the limit is per-proxy or per-client. If per-client, parse `X-Forwarded-For` only from a trusted-proxy allowlist; document the choice. Also protect `_buckets` with a lock — sync route handlers run concurrently in FastAPI's threadpool and `rate_limit` mutates a module-level `defaultdict(deque)` with no synchronisation (`api.py:30, 81-95`).

**WebSocket endpoint is unauthenticated and uncapped:**
- Risk: `/ws/live` accepts any connection and adds a queue to `runtime.ws_clients` with no authentication, no connection limit, and no rate limiting — the middleware that enforces `rate_limit` explicitly excludes non-`/api/` paths (`backend/suryakavach/api.py:167-174, 387-396`).
- Files: `backend/suryakavach/api.py:167-174, 387-396`, `backend/suryakavach/runtime.py:61, 210-229`
- Impact: An unauthenticated caller can open many sockets; each joins the broadcast set and receives every frame, and `_broadcast` iterates the whole set on every tick.
- Recommendations: Cap the number of concurrent WS clients (reject with 1013 when full), and consider requiring the same origin checks applied to CORS.

**A `.env.production` file is tracked in git:**
- Risk: `apps/web/.env.production` is committed (confirmed via `git ls-files`), and `.gitignore` covers only `.env` and `.env.local`. Its current contents are build-time public values (`VITE_WS_URL`), but the pattern invites committing a secret into a file with no ignore rule.
- Files: `apps/web/.env.production`, `.gitignore:18-19`
- Current mitigation: The web Docker build (`apps/web/Dockerfile:1-9`) copies the whole `apps/web` context, so this file is intentionally baked into the frontend image — it must never hold a secret.
- Recommendations: Add `.env.production` to `.gitignore`, keep only a committed `.env.example`, and inject production values at build time.

**Secret variable names (values not inspected):**
- `SUPABASE_SERVICE_ROLE_KEY` is read in `backend/suryakavach/supabase_db.py:15` and passed to `create_client` (`supabase_db.py:18`). It is a service-role credential that bypasses row-level security.
- `SUPABASE_URL` (`backend/suryakavach/supabase_db.py:14`) and `CORS_ORIGINS` / `CORS_ORIGIN_REGEX` (`backend/suryakavach/api.py:44, 52`) are read from the environment.
- `COMPOSIO_API_KEY` is read in `composio-mcp.ts:8`.
- These are referenced by name only; the service-role key must remain server-side and is not exposed by any client bundle.

## Performance Bottlenecks

**`Runtime.tick()` holds the global lock across DB round-trips and full recomputation:**
- Problem: `tick()` acquires `self.lock` (`backend/suryakavach/runtime.py:737`) and, while holding it, calls `_nowcast_until`, `impact_current`, `forecast_horizons`, `streams_latest`, `nowcast_state`, and one or more `_emit_alert` calls, each of which performs a `conn.execute(...)` followed by `conn.commit()` (`runtime.py:598-607, 736-815`).
- Files: `backend/suryakavach/runtime.py:598-815`
- Cause: Every alert is a synchronous write plus commit inside the lock; under the Supabase backend each is an HTTP round-trip (`backend/suryakavach/db.py:234-244`). The sim loop runs this off the event loop via `asyncio.to_thread(runtime.tick)` (`backend/suryakavach/api.py:201`), but it still serialises against every API handler that takes the same lock.
- Improvement path: Buffer alerts and flush once per tick; move alert emission outside the lock; cache `forecast_horizons` for a tick instead of recomputing on every API call.

**`_nowcast_until` is recomputed on every API request:**
- Problem: `streams_latest`, `nowcast_state`, and `impact_current` each independently call `self._nowcast_until(self.cursor)` (`backend/suryakavach/runtime.py:284, 367, 463`), which rebuilds the event list and clones each `FlareEvent` with `dataclasses.replace` (`runtime.py:335-364`).
- Files: `backend/suryakavach/runtime.py:280-364`
- Cause: No per-cursor caching; a page that polls `/api/streams/latest`, `/api/nowcast/state`, and `/api/impact/current` triggers three full reconstructions per refresh interval (`apps/web/src/lib/hooks.ts:19-52` poll every 10 s).

**`config.yaml` is re-read from disk on each `load_config()` call:**
- Problem: `load_config()` opens and YAML-parses the file every call (`backend/suryakavach/config.py:12-22`); it is called at import in `backend/suryakavach/api.py:29`, from `Runtime.__init__` (`runtime.py:57`), and from `_default_real_dir` (`pradan.py:138`). No `lru_cache`.
- Files: `backend/suryakavach/config.py:12-22`

**Python-level forward-fill loops over 1440 samples:**
- Problem: `_ffill` iterates element-by-element in Python in three places (`runtime.py:39-43`, `pradan.py:235-239`, `evaluate.py:34-44`), and `forecast_horizons` calls it on every request (`runtime.py:447-448`).
- Files: `backend/suryakavach/runtime.py:26-44`, `backend/suryakavach/ingest/pradan.py:228-240`
- Improvement path: Vectorise with `np.maximum.accumulate` over a finite mask, or reuse a single cached filled array per day.

## Fragile Areas

**PRADAN real-day ingest (active work-in-progress):**
- Files: `backend/suryakavach/ingest/pradan.py` (modified in the working tree), `backend/suryakavach/runtime.py:122-138`
- Why fragile: The module is split across three risk surfaces at once — untrusted CSV parsing (above), a silent fallback path, and a file-format claim (FITS) that the code does not honour. `_build_preferred_days` catches only three exception types, so a `TypeError` from the parser escapes into `Runtime.boot`, whose `except Exception` re-raises after setting `engine_status` to `"error"` (`runtime.py:109-112`). `boot` is awaited during the FastAPI lifespan (`api.py:121`), so one malformed real-day file takes the whole process down instead of degrading to synthetic.
- Safe modification: When changing the parser, keep the "return `None` for a bad row" contract rather than raising, and add a test with a malformed CSV (extra columns, `None` cells, bad timestamp) plus a FITS-only directory.
- Test coverage: Partial. PRADAN catalogue parsing (`test_pradan_catalogue.py`), authenticated sessions (`test_pradan_session.py`), product registry (`test_registry.py`), and FITS/NetCDF product readers (`test_fits_products.py`, `test_magnetometer.py`) are fully tested; legacy `pradan.py` fallback paths remain covered by `test_engines.py`.

**BOCPD's new finiteness guard converts a silent bug into a hard boot failure (uncommitted work-in-progress):**
- Files: `backend/suryakavach/engines/bocpd.py:44-47, 79-89` (modified in the working tree)
- Why fragile: `update()` now raises `ValueError` on non-finite input and `run()` raises if any element is non-finite. The only upstream sanitiser, `Runtime._ffill`, replaces `np.isnan` values but does **not** touch `inf` (`backend/suryakavach/runtime.py:39-42`). Previously an `inf`/`NaN` propagated as a `NaN` posterior; now it aborts `run_nowcast` → `_run_all_nowcasts` → `boot`, which re-raises (`runtime.py:109-112`) and leaves every endpoint answering 503 (`api.py:110-113, 158-164`).
- Safe modification: Make `_ffill` clamp with `np.isfinite` (not just `np.isnan`) before feeding `log10`/BOCPD, and decide whether `run_nowcast` should degrade per-day rather than abort the whole boot.
- Test coverage: `backend/tests/test_engines.py:31-43` covers the happy path only; no test feeds `inf`/`NaN` through `BOCPD.run` or through boot.

**Real and synthetic days are mixed in one cache with different invariants:**
- Files: `backend/suryakavach/runtime.py:122-138, 140-162, 628-654`
- Why fragile: Real days are added with `real_day["truth"] = []` (`runtime.py:136`) and overwrite any synthetic day with the same key. `_fit_forecast` iterates `self.days.values()` and derives labels from `day["truth"]`, so a real day contributes an all-negative training slice (`runtime.py:147-158`), skewing the hazard prior. `start_replay` reads `truth` and falls back to `cursor = 0` when it is empty (`runtime.py:637-645`), so replaying a real day starts at midnight rather than before an event.
- Safe modification: Track provenance (`day["source"]`) and exclude truth-less days from forecast fitting, or synthesise labels for real days from the nowcast output.
- Test coverage: No test exercises `_build_preferred_days` or a `real_days/` directory.

**`Runtime` is constructed at import time and performs I/O:**
- Files: `backend/suryakavach/runtime.py:842`, `runtime.py:56-59`, `backend/suryakavach/db.py:121-126`
- Why fragile: The module docstring at `runtime.py:839-841` states importing must be "cheap and free of side effects", but `Runtime(boot=False)` still calls `load_config()` and `connect(...)`, which creates the cache directory and opens (creating if absent) the SQLite file. Import-time I/O makes the module hostile to tests that want to point `SURYAKAVACH_DATA` elsewhere, and `_sqlite_connect` mutates the DB without closing it.

**`flare_detail` indexes the nowcast cache by a date parsed from the stored timestamp:**
- Files: `backend/suryakavach/runtime.py:541-587`
- Why fragile: `date = rec["onset"][:10]` then `nc = self.nowcast_by_day[date]` at `runtime.py:558`. If the stored `onset` date does not match a cache key (which is exactly what the PRADAN `ts` misalignment above would produce), this raises an uncaught `KeyError` → 500.
- Safe modification: Use `self.nowcast_by_day.get(date)` and return the row without the series (as the function already does when `self.days.get(date)` misses at `runtime.py:547-549`).

**Catalogue filtering happens in Python after a capped fetch:**
- Files: `backend/suryakavach/runtime.py:508-539`, `backend/suryakavach/db.py:59, 280-295`
- Why fragile: The SQL has no `LIMIT`, so Supabase truncates at `_CATALOGUE_MAX_ROWS = 5000` (`db.py:59, 293`) and the class filter is applied in Python afterwards (`runtime.py:522`). If the table exceeds 5000 rows the result is silently wrong (missing items), not an error.

## Scaling Limits

**Alerts table:**
- Current capacity: `MAX_ALERTS = 2000`, pruned every 200 emissions (`backend/suryakavach/runtime.py:52, 604-607`).
- Limit: Pruning only works on the SQLite backend; on Supabase the prune raises and is swallowed (`runtime.py:622-626`, see Tech Debt).
- Scaling path: Implement prune in the Supabase shim, or cap rows via a rolling delete at insert time.

**WebSocket clients:**
- Current capacity: unbounded set (`backend/suryakavach/runtime.py:61`).
- Limit: `_broadcast` iterates the full set every tick (`runtime.py:210-229`), and each queue holds up to 8 frames (`api.py:395`); hundreds of idle clients would add per-tick cost and memory with no back-pressure beyond per-queue frame dropping.
- Scaling path: Enforce a max-client count and reject with code 1013.

**In-memory day cache:**
- Current capacity: all synthetic days plus every directory under `<cache_path>/real_days/` are held simultaneously (`backend/suryakavach/runtime.py:122-138`), each as 1440-element float arrays plus a full `NowcastResult` per day (`runtime.py:164-175`).
- Limit: Memory grows linearly with the number of real days dropped in.

## Dependencies at Risk

**Non-deterministic frontend installs:**
- Risk: `apps/web/Dockerfile:4` runs `npm install` while a `package-lock.json` exists; `npm install` may resolve and rewrite the lock, so the image is not reproducible.
- Impact: A downstream dependency release can change a previously working build.
- Migration plan: Switch to `npm ci`.

**Broad caret ranges on fast-moving frontend majors:**
- Risk: `apps/web/package.json` uses `^` for `vite ^7.3.6`, `vitest ^4.1.11`, `jsdom ^25.0.0`, `@types/node ^26.4.1`, `@tanstack/react-query ^5.62.0`. `^` allows minor/patch drift on already-new majors (Node 26 type definitions in particular are ahead of most tooling).
- Impact: Lockfile refresh can pull breaking changes; `@types/node` major mismatch with the actual runtime (Node 20 in `apps/web/Dockerfile:1`) can type-check APIs that do not exist at runtime.
- Migration plan: Pin the toolchain majors exactly, or align `@types/node` with the Node version used in the build image.

**Backend requirements are pinned with `==` (good), but several are unused by default:**
- Risk: `backend/requirements.txt` pins `supabase==2.10.0` and `psycopg2-binary==2.9.10`, which are only exercised when `USE_SUPABASE=1`. The comment at `requirements.txt:9-10` documents a fragile `httpx<0.28` constraint imposed by supabase 2.10.0.
- Impact: The version constraint exists solely to satisfy a dependency that defaults to unused; a future `httpx` upgrade is blocked or breaks the Supabase path.
- Migration plan: Keep the pin, but add the fake-Supabase test above so the compatibility constraint is verified rather than assumed.

## Missing Critical Features

**No authentication or authorization anywhere:**
- Problem: Every `/api/*` route and `/ws/live` is open (`backend/suryakavach/api.py:232-439`). The only controls are rate limiting and CORS.
- Blocks: Any deployment that exposes real operational data or the replay-control mutations (`/api/replay/*`) to untrusted users. Any caller can stop/start replay and seek the cursor for everyone, since replay state is global (`backend/suryakavach/runtime.py:628-734`).

**No structured error tracking or metrics:**
- Problem: Logging is a single `logging.getLogger("suryakavach.api")` (`api.py:28`) with `log.exception` in two places (`api.py:206, 425`). There is no error-tracking integration, no request logging, and no health metric beyond the coarse `status: ok|degraded` (`runtime.py:265-278`).
- Blocks: Detecting the swallowed failures (prune, boot guard, parse errors) in production.

## Test Coverage Gaps

**PRADAN ingest:**
- What's not tested: `load_real_day_files`, `_parse_flux_csv`, `_parse_dt`, `_resample_minute`, `_ffill`, and the FITS/CSV format handling.
- Files: `backend/suryakavach/ingest/pradan.py`
- Risk: Every failure mode in this document's Security and Known Bugs sections ships unverified; a malformed product file can crash boot or silently produce flat data.
- Priority: High

**Supabase persistence shim:**
- What's not tested: `_SupaWrapper._execute`, `_upsert_flares`, `flush_flares`, `_catalogue`, and the fallback `_SupaCursor` behavior.
- Files: `backend/suryakavach/db.py:129-299`
- Risk: The production deployment (`render.yaml` sets `USE_SUPABASE=1`) runs a code path no test touches; the alert-prune failure is a live consequence.
- Priority: High

**BOCPD non-finite handling:**
- What's not tested: The new `ValueError` guards in `BOCPD.update`/`BOCPD.run`.
- Files: `backend/suryakavach/engines/bocpd.py:44-47, 79-89`, `backend/tests/test_engines.py:31-43`
- Risk: The stricter guard can turn a degraded day into a boot failure; no test proves which.
- Priority: Medium

**`_nowcast_until` causal slicing:**
- What's not tested: The mid-rise re-derivation and `dataclasses.replace` clones in `_nowcast_until` and `_flare_public(prefix=True)`.
- Files: `backend/suryakavach/runtime.py:335-442`
- Risk: This is the code that prevents future-point leakage in the live early-warning view; a regression would make the demo look prescient without failing any test.
- Priority: Medium

**Dev tooling:**
- What's not tested: `scripts/dev.mjs` (port-conflict handling, shutdown exit codes, child teardown).
- Files: `scripts/dev.mjs`
- Risk: The exit-code bug above is invisible to CI.
- Priority: Low

**Real-day integration into the runtime:**
- What's not tested: `_build_preferred_days`, mixing real and synthetic days, and forecast fitting over truth-less days.
- Files: `backend/suryakavach/runtime.py:122-162`
- Risk: Silent training-set degradation when real data is added.
- Priority: Medium

## TODO/FIXME/HACK Markers

No `TODO`, `FIXME`, `HACK`, or `XXX` comments exist in `apps/web/src`, `backend/suryakavach`, or `scripts` (grep across the tree returns only a base64 lockfile string and one `# pragma: no cover` at `backend/suryakavach/runtime.py:109`). The absence is itself worth noting: the two stubbed/dead items (`fetch_pradan_day` at `pradan.py:118-132` and `composio-mcp.ts`) carry no marker, so they read as finished work.

---

*Concerns audit: 2026-09-19*
