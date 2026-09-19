from __future__ import annotations

import asyncio
import csv
import io
import logging
import os
import re
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from suryakavach.config import load_config
from suryakavach.goes import CLASS_RANK
from suryakavach.runtime import runtime

# YYYY-MM-DD, optionally followed by an ISO time component.
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}([T ].*)?$")

UTC = timezone.utc
log = logging.getLogger("suryakavach.api")
cfg = load_config()
_buckets: dict[str, deque] = defaultdict(deque)
# Hard ceiling on tracked client IPs. Without it, one host spraying spoofed
# X-Forwarded-For values (or plain traffic from many addresses) grows this dict
# without bound — a slow memory leak reachable by any unauthenticated caller.
_MAX_BUCKETS = 4096


def _allowed_origins() -> list[str]:
    """Config origins plus anything in CORS_ORIGINS (comma-separated).

    Deployments need to add an origin (a Vercel preview URL, a custom domain)
    without editing config.yaml and rebuilding the image.
    """
    origins = [str(o) for o in cfg.get("cors_origins") or []]
    extra = os.environ.get("CORS_ORIGINS", "")
    origins += [o.strip() for o in extra.split(",") if o.strip()]
    seen: set[str] = set()
    return [o for o in origins if not (o in seen or seen.add(o))]


def _origin_regex() -> str | None:
    """Optional regex for origins, e.g. Vercel preview deployments."""
    return os.environ.get("CORS_ORIGIN_REGEX") or None


class ReplayStart(BaseModel):
    event_date: str = Field(default="2024-02-22")
    speed: float = Field(default=20, ge=1, le=60)


class CursorSet(BaseModel):
    idx: int = Field(ge=0, le=1439)


class ReplayControl(BaseModel):
    action: Literal["play", "pause", "toggle", "stop", "seek", "speed", "status"]
    speed: float | None = Field(default=None, ge=1, le=60)
    cursor: int | None = Field(default=None, ge=0, le=1439)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _sweep_buckets(now: float) -> None:
    """Drop buckets with no requests in the last window."""
    stale = [ip for ip, q in _buckets.items() if not q or now - q[-1] > 60]
    for ip in stale:
        del _buckets[ip]


def rate_limit(request: Request) -> None:
    ip = _client_ip(request)
    now = time.time()
    if ip not in _buckets and len(_buckets) >= _MAX_BUCKETS:
        _sweep_buckets(now)
        if len(_buckets) >= _MAX_BUCKETS:
            # Still saturated: refuse rather than keep allocating.
            raise RateLimited()
    q = _buckets[ip]
    lim = int(cfg["rate_limit"]["requests_per_minute"])
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= lim:
        raise RateLimited()
    q.append(now)


class RateLimited(Exception):
    pass


class BadRequest(Exception):
    """A client-visible 400, distinct from an internal ValueError."""


class NotFound(Exception):
    """A client-visible 404."""


class NotReady(Exception):
    """Engines have not finished booting yet."""


def require_ready() -> None:
    if not runtime.booted:
        raise NotReady()


@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime.loop = asyncio.get_running_loop()
    # Engine boot takes seconds (synthetic cache + BOCPD over every day + DB
    # writes). Run it in a worker thread so the event loop can serve
    # /api/health immediately instead of the platform's health check timing out.
    await asyncio.to_thread(runtime.boot)
    task = asyncio.create_task(_sim_loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="SURYAKAVACH API",
    version="1.0.0",
    description="Indigenous solar-flare nowcast / forecast / impact prototype (SIH26209).",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_origin_regex=_origin_regex(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(RateLimited)
async def _rl(_req, _exc):
    return JSONResponse({"data": None, "meta": {"error": "rate_limited"}}, status_code=429)


@app.exception_handler(BadRequest)
async def _br(_req, exc: BadRequest):
    return JSONResponse({"data": None, "meta": {"error": str(exc)}}, status_code=400)


@app.exception_handler(NotFound)
async def _nf(_req, exc: NotFound):
    return JSONResponse({"data": None, "meta": {"error": str(exc)}}, status_code=404)


@app.exception_handler(NotReady)
async def _nr(_req, _exc):
    return JSONResponse(
        {"data": None, "meta": {"error": "starting", "detail": "engines are still booting"}},
        status_code=503,
        headers={"Retry-After": "5"},
    )


@app.middleware("http")
async def _limit(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method != "OPTIONS":
        try:
            rate_limit(request)
        except RateLimited:
            return JSONResponse({"data": None, "meta": {"error": "rate_limited"}}, status_code=429)
    return await call_next(request)


async def _sim_loop():
    """Advance the replay cursor and broadcast a frame once per tick.

    Any exception from a single tick is logged and swallowed: previously one
    transient failure killed this task for the whole process lifetime, leaving
    the API up but the replay frozen with no error surfaced anywhere.
    """
    while True:
        # speed N => N data-minutes per real minute → sleep 60/N seconds.
        # Wait on speed_changed so a speed update interrupts the sleep instead
        # of taking effect up to 60 s later.
        sp = max(runtime.speed, 1.0)
        try:
            try:
                await asyncio.wait_for(runtime.speed_changed.wait(), timeout=60.0 / sp)
            except asyncio.TimeoutError:
                pass
            else:
                runtime.speed_changed.clear()
                continue
            if not runtime.playing or not runtime.booted:
                continue
            # tick() is CPU-bound (~10 ms) and takes a threading lock; keep it
            # off the event loop so requests and WS sends are not stalled.
            payload = await asyncio.to_thread(runtime.tick)
            await _broadcast(payload)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("sim loop tick failed; continuing")
            await asyncio.sleep(1.0)


async def _broadcast(payload: dict) -> None:
    """Fan a frame out to every WS client, dropping stale frames on backpressure.

    A client that cannot keep up used to be silently unsubscribed on the first
    full queue and then never received anything again while its socket stayed
    open. Instead, discard that client's oldest queued frame and enqueue the
    newest: for a live monitor the freshest state is what matters.
    """
    for q in list(runtime.ws_clients):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            with suppress(asyncio.QueueEmpty):
                q.get_nowait()
            try:
                q.put_nowait(payload)
            except Exception:
                runtime.ws_clients.discard(q)
        except Exception:
            runtime.ws_clients.discard(q)


@app.get("/api/health")
def health():
    """Always answers, even mid-boot, so platform health checks can succeed."""
    return runtime.envelope(runtime.health())


@app.get("/api/streams/latest")
def streams(window: int = Query(120, ge=10, le=1440)):
    require_ready()
    return runtime.envelope(runtime.streams_latest(window))


@app.get("/api/nowcast/state")
def nowcast():
    require_ready()
    return runtime.envelope(runtime.nowcast_state())


@app.get("/api/flare/catalogue")
def catalogue(
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    min_class: str = "A",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=500),
    method: str | None = None,
    format: str | None = None,
):
    require_ready()
    if min_class and min_class.upper()[0] not in CLASS_RANK:
        raise BadRequest(
            f"min_class must be one of {', '.join(CLASS_RANK)}; got {min_class!r}"
        )
    for name, value in (("from", frm), ("to", to)):
        if value and not _DATE_RE.match(value):
            raise BadRequest(f"{name} must be YYYY-MM-DD or an ISO timestamp; got {value!r}")
    data = runtime.catalogue(frm, to, min_class, page, page_size, method)
    if format == "csv":
        buf = io.StringIO()
        cols = [
            "id",
            "onset",
            "peak",
            "end",
            "class",
            "peak_flux_sxr",
            "peak_flux_hxr",
            "hardness",
            "impulsivity",
            "integrated_flux",
            "impact_index",
            "severity_band",
            "r_level",
            "detection_method",
        ]
        w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for row in data["items"]:
            w.writerow(row)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=suryakavach-catalogue.csv"},
        )
    return runtime.envelope(data)


@app.get("/api/flare/{fid}")
def flare(fid: str):
    require_ready()
    rec = runtime.flare_detail(fid)
    if not rec:
        # Preserve the standard envelope meta and add the error, rather than
        # replacing meta wholesale (which dropped timestamp/mode/cursor).
        payload = runtime.envelope(None)
        payload["meta"]["error"] = "not_found"
        return JSONResponse(payload, status_code=404)
    return runtime.envelope(rec)


@app.get("/api/forecast/horizons")
def forecast():
    require_ready()
    return runtime.envelope(runtime.forecast_horizons())


@app.get("/api/impact/current")
def impact():
    require_ready()
    return runtime.envelope(runtime.impact_current())


@app.get("/api/impact/scale")
def impact_scale():
    require_ready()
    return runtime.envelope(runtime.impact_scale())


@app.get("/api/alerts")
def alerts(since: str | None = None):
    require_ready()
    if since and not _DATE_RE.match(since):
        raise BadRequest(f"since must be YYYY-MM-DD or an ISO timestamp; got {since!r}")
    return runtime.envelope(runtime.alerts(since))


@app.get("/api/metrics")
def get_metrics(
    cohort: str | None = None,
    run_id: str | None = None,
):
    require_ready()
    conn = runtime.conn
    if run_id:
        from suryakavach.db import get_evaluation_run_by_id
        run_data = get_evaluation_run_by_id(conn, run_id)
    else:
        from suryakavach.db import get_latest_evaluation_run
        run_data = get_latest_evaluation_run(conn, source_cohort=cohort)

    if not run_data:
        json_p = Path("reports/evaluation_latest.json")
        if json_p.exists():
            try:
                import json
                file_data = json.loads(json_p.read_text(encoding="utf-8"))
                if run_id:
                    if file_data.get("id") == run_id:
                        run_data = file_data
                elif cohort:
                    if file_data.get("source_cohort") == cohort:
                        run_data = file_data
                else:
                    run_data = file_data
            except Exception:
                pass

    if not run_data:
        if run_id:
            raise NotFound(f"Evaluation run '{run_id}' not found")
        elif cohort:
            raise NotFound(f"Evaluation run for cohort '{cohort}' not found")
        else:
            raise NotFound("No evaluation run available")

    created_at_str = run_data.get("created_at", "")
    age_seconds = 0
    if created_at_str:
        try:
            created_dt = datetime.fromisoformat(created_at_str)
            age_seconds = max(0, int((datetime.now(UTC) - created_dt).total_seconds()))
        except Exception:
            pass

    run_data["age_seconds"] = age_seconds
    return runtime.envelope(run_data)


@app.get("/api/metrics/{run_id}")
def get_metrics_by_id(run_id: str):
    require_ready()
    from suryakavach.db import get_evaluation_run_by_id
    run_data = get_evaluation_run_by_id(runtime.conn, run_id)
    if not run_data:
        json_p = Path("reports/evaluation_latest.json")
        if json_p.exists():
            try:
                import json
                file_data = json.loads(json_p.read_text(encoding="utf-8"))
                if file_data.get("id") == run_id:
                    run_data = file_data
            except Exception:
                pass

    if not run_data:
        raise NotFound(f"Evaluation run '{run_id}' not found")

    created_at_str = run_data.get("created_at", "")
    age_seconds = 0
    if created_at_str:
        try:
            created_dt = datetime.fromisoformat(created_at_str)
            age_seconds = max(0, int((datetime.now(UTC) - created_dt).total_seconds()))
        except Exception:
            pass

    run_data["age_seconds"] = age_seconds
    return runtime.envelope(run_data)


@app.get("/api/replay/dates")
def dates():
    require_ready()
    return runtime.envelope({"dates": runtime.available_dates()})


@app.post("/api/replay/start")
def replay_start(body: ReplayStart):
    require_ready()
    if body.event_date not in runtime.days:
        raise BadRequest(
            f"unknown event_date {body.event_date!r}; "
            f"available: {', '.join(runtime.available_dates())}"
        )
    return runtime.envelope(runtime.start_replay(body.event_date, body.speed))


@app.post("/api/replay/stop")
def replay_stop():
    require_ready()
    return runtime.envelope(runtime.stop_replay())


@app.post("/api/replay/cursor")
def replay_cursor(body: CursorSet):
    require_ready()
    runtime.set_cursor(body.idx)
    # Return the canonical state so the client stays in sync, matching
    # /api/replay/control and the other replay mutations.
    return runtime.envelope(runtime.replay_state())


@app.post("/api/replay/pause")
def replay_pause():
    require_ready()
    return runtime.envelope(runtime.control("pause"))


@app.post("/api/replay/resume")
def replay_resume():
    require_ready()
    return runtime.envelope(runtime.control("play"))


@app.post("/api/replay/control")
def replay_control(body: ReplayControl):
    """Unified replay control: play, pause, toggle, stop, seek, speed, status."""
    require_ready()
    try:
        state = runtime.control(body.action, body.speed, body.cursor)
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
    return runtime.envelope(state)


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    if not runtime.booted:
        # Nothing to stream yet; tell the client to retry rather than holding a
        # socket open that will never receive a snapshot.
        await ws.close(code=1013, reason="starting")
        return
    q: asyncio.Queue = asyncio.Queue(maxsize=8)
    runtime.ws_clients.add(q)
    # Drain inbound frames concurrently. Without a reader, a client's close
    # frame is not observed until the next send fails, and any data it sends
    # accumulates in the transport buffer.
    reader = asyncio.create_task(_ws_drain(ws))
    try:
        await ws.send_json(runtime.live_snapshot())
        while True:
            if reader.done():
                break
            getter = asyncio.ensure_future(q.get())
            done, _ = await asyncio.wait(
                {getter, reader}, timeout=30.0, return_when=asyncio.FIRST_COMPLETED
            )
            if getter in done:
                await ws.send_json(getter.result())
                continue
            getter.cancel()
            with suppress(asyncio.CancelledError):
                await getter
            if reader in done:
                break
            await ws.send_json(
                {"heartbeat": True, "ts": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}
            )
    except (WebSocketDisconnect, RuntimeError):
        # RuntimeError covers "Cannot call send once a close message has been sent".
        pass
    except Exception:
        log.exception("websocket stream failed")
    finally:
        runtime.ws_clients.discard(q)
        reader.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await reader
        with suppress(Exception):
            await ws.close()


async def _ws_drain(ws: WebSocket) -> None:
    """Consume inbound frames until the client disconnects."""
    with suppress(WebSocketDisconnect, RuntimeError):
        while True:
            await ws.receive()
