from __future__ import annotations

import pytest


def test_health_endpoint(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    json_data = response.json()
    assert "data" in json_data
    assert json_data["data"]["status"] == "ok"
    assert "engines" in json_data["data"]


def test_streams_latest(client):
    response = client.get("/api/streams/latest?window=60")
    assert response.status_code == 200
    json_data = response.json()
    assert "solexs" in json_data["data"]
    assert "hel1os" in json_data["data"]


def test_nowcast_state(client):
    response = client.get("/api/nowcast/state")
    assert response.status_code == 200
    json_data = response.json()
    assert "state" in json_data["data"]
    assert "active" in json_data["data"]


def test_catalogue_endpoints(client):
    # JSON
    res_json = client.get("/api/flare/catalogue?format=json")
    assert res_json.status_code == 200
    jdata = res_json.json()
    assert "items" in jdata["data"]
    assert len(jdata["data"]["items"]) > 0

    first_id = jdata["data"]["items"][0]["id"]

    # CSV
    res_csv = client.get("/api/flare/catalogue?format=csv")
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.headers["content-type"]

    # Flare detail
    res_flare = client.get(f"/api/flare/{first_id}")
    assert res_flare.status_code == 200
    assert res_flare.json()["data"]["id"] == first_id

    # Not found flare
    res_404 = client.get("/api/flare/non-existent-flare-id")
    assert res_404.status_code == 404


def test_forecast_and_impact(client):
    res_fc = client.get("/api/forecast/horizons")
    assert res_fc.status_code == 200
    assert "horizons" in res_fc.json()["data"]

    res_imp = client.get("/api/impact/current")
    assert res_imp.status_code == 200
    assert "index" in res_imp.json()["data"]

    res_scale = client.get("/api/impact/scale")
    assert res_scale.status_code == 200
    scale = res_scale.json()["data"]
    assert scale["version"] == "2026-09-19-v1"
    assert [band["r_level"] for band in scale["bands"]] == ["R0", "R1", "R2", "R3", "R4", "R5"]
    assert sum(scale["weights"].values()) == pytest.approx(1.0)


def test_replay_controls(client):
    res_dates = client.get("/api/replay/dates")
    assert res_dates.status_code == 200
    assert "dates" in res_dates.json()["data"]

    res_start = client.post("/api/replay/start", json={"event_date": "2024-02-22", "speed": 20})
    assert res_start.status_code == 200

    res_pause = client.post("/api/replay/pause")
    assert res_pause.status_code == 200
    assert res_pause.json()["data"]["playing"] is False

    res_resume = client.post("/api/replay/resume")
    assert res_resume.status_code == 200
    assert res_resume.json()["data"]["playing"] is True

    res_cursor = client.post("/api/replay/cursor", json={"idx": 100})
    assert res_cursor.status_code == 200

    res_stop = client.post("/api/replay/stop")
    assert res_stop.status_code == 200


def _control(client, **body):
    res = client.post("/api/replay/control", json=body)
    return res, res.json()


def test_replay_control_actions(client):
    """Every action returns the full canonical replay state."""
    res, payload = _control(client, action="status")
    assert res.status_code == 200
    for key in ("playing", "speed", "cursor_idx", "cursor", "event_date", "mode"):
        assert key in payload["data"], f"missing {key} in replay state"

    _, paused = _control(client, action="pause")
    assert paused["data"]["playing"] is False

    _, played = _control(client, action="play")
    assert played["data"]["playing"] is True

    _, toggled = _control(client, action="toggle")
    assert toggled["data"]["playing"] is False

    _, seeked = _control(client, action="seek", cursor=600)
    assert seeked["data"]["cursor_idx"] == 600
    assert seeked["data"]["cursor"].endswith("T10:00:00Z")

    _, sped = _control(client, action="speed", speed=5)
    assert sped["data"]["speed"] == 5.0

    # speed/cursor may accompany any action
    _, combo = _control(client, action="play", speed=20, cursor=300)
    assert combo["data"] == {
        **combo["data"],
        "playing": True,
        "speed": 20.0,
        "cursor_idx": 300,
    }

    _, stopped = _control(client, action="stop")
    assert stopped["data"]["playing"] is False


def test_replay_control_validation(client):
    # Actions requiring a parameter must reject its absence.
    assert _control(client, action="seek")[0].status_code == 400
    assert _control(client, action="speed")[0].status_code == 400
    # Out-of-range and unknown values are rejected by the schema.
    assert _control(client, action="bogus")[0].status_code == 422
    assert _control(client, action="speed", speed=999)[0].status_code == 422
    assert _control(client, action="speed", speed=0)[0].status_code == 422
    assert _control(client, action="seek", cursor=99999)[0].status_code == 422
    assert _control(client, action="seek", cursor=-1)[0].status_code == 422


def test_replay_control_speeds_match_config(client):
    """Every speed the config advertises must be accepted by the API."""
    from suryakavach.config import load_config

    for speed in load_config()["replay"]["speeds"]:
        res, payload = _control(client, action="speed", speed=speed)
        assert res.status_code == 200, f"speed {speed} rejected"
        assert payload["data"]["speed"] == float(speed)


def test_legacy_replay_routes_return_state(client):
    """pause/resume delegate to control and return the full state."""
    _, paused = _control(client, action="play")
    res = client.post("/api/replay/pause")
    assert res.status_code == 200
    assert res.json()["data"]["playing"] is False
    assert "cursor_idx" in res.json()["data"]

    res = client.post("/api/replay/resume")
    assert res.status_code == 200
    assert res.json()["data"]["playing"] is True


def test_ws_live(client):
    with client.websocket_connect("/ws/live") as websocket:
        data = websocket.receive_json()
        assert "clock" in data or "nowcast_state" in data


def test_metrics_endpoint(client):
    res = client.get("/api/metrics")
    assert res.status_code == 200
    jdata = res.json()
    assert "data" in jdata
    data = jdata["data"]
    assert "id" in data
    assert "source_cohort" in data
    assert "config_hash" in data
    assert "detection_metrics" in data
    assert "horizon_brier_scores" in data

    run_id = data["id"]
    res_id = client.get(f"/api/metrics/{run_id}")
    assert res_id.status_code == 200
    assert res_id.json()["data"]["id"] == run_id

    res_404 = client.get("/api/metrics/non-existent-run-id-12345")
    assert res_404.status_code in (400, 404)

